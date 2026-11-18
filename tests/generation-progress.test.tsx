import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { generationSubmissionResponse } from "@/lib/reference-video/generation-submission-response";
import { readGenerationSubmission, GenerationSubmissionInterrupted } from "@/lib/reference-video/read-generation-submission";
import { advanceGenerationProgress } from "@/lib/reference-video/generation-progress";
import { GenerationTaskProgress } from "@/components/reference-video/generation-task-progress";
import { submitCommercialGeneration, type GenerationSubmissionBatch } from "@/lib/reference-video/commercial-generation-submit";
import type { GenerationVariant } from "@/lib/reference-video/types";

const request = (stream = true) => new Request("https://local.test/api/generation-jobs", { headers: stream ? { Accept: "application/x-ndjson" } : {} });

describe("generation submission checkpoints", () => {
  it("streams real checkpoints before the final response, preserving error status", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const response = await generationSubmissionResponse(request(), async report => {
      report("preparing"); report("moderating"); await waiting;
      return Response.json({ code: "PROMPT_SCAN_UNAVAILABLE" }, { status: 503 });
    });
    const stages: string[] = [];
    const result = readGenerationSubmission(response, stage => stages.push(stage));
    await vi.waitFor(() => expect(stages).toEqual(["preparing", "moderating"]));
    finish();
    expect(await result).toEqual({ status: 503, body: { code: "PROMPT_SCAN_UNAVAILABLE" } });
  });
  it("retains legacy JSON and HTTP semantics", async () => {
    const response = await generationSubmissionResponse(request(false), async () => Response.json({ code: "PROMPT_BLOCKED" }, { status: 422 }));
    expect(response.status).toBe(422);
    expect(await readGenerationSubmission(response, vi.fn())).toEqual({ status: 422, body: { code: "PROMPT_BLOCKED" } });
  });
  it("decodes split UTF-8 and a final line without newline", async () => {
    const bytes = new TextEncoder().encode('{"type":"stage","stage":"submitting"}\n{"type":"result","status":200,"body":{"providerTaskId":"任务"}}');
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "Content-Type": "application/x-ndjson" } });
    const stage = vi.fn();
    expect((await readGenerationSubmission(response, stage)).body.providerTaskId).toBe("任务");
    expect(stage).toHaveBeenCalledWith("submitting");
  });
  it("treats a lost final response as uncertain without retrying submission", async () => {
    const execute = vi.fn(async report => { report("submitting"); return Response.json({ providerTaskId: "one" }); });
    const response = await generationSubmissionResponse(request(), execute);
    const reader = response.body!.getReader();
    await reader.read(); await reader.cancel();
    expect(execute).toHaveBeenCalledTimes(1);
    const truncated = new Response('{"type":"stage","stage":"submitting"}\n', { headers: { "Content-Type": "application/x-ndjson" } });
    await expect(readGenerationSubmission(truncated, vi.fn())).rejects.toBeInstanceOf(GenerationSubmissionInterrupted);
  });
  it("does not expose unexpected exception details through the stream", async () => {
    const response = await generationSubmissionResponse(request(), async () => { throw new Error("secret-prompt-and-key"); });
    const text = await response.text();
    expect(text).not.toContain("secret-prompt-and-key");
    expect(text).toContain('"status":500');
  });
  it("preserves per-output streamed quotes and confirms the original batch once", async () => {
    const batch: GenerationSubmissionBatch = { version: 1, request: {}, quantity: 2, quotes: [], confirmationStarted: false };
    const quote = async (id: string) => generationSubmissionResponse(request(), async report => { report("moderating"); report("quoting"); return Response.json({ id, credits: 20 }); });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(await quote("one")).mockResolvedValueOnce(await quote("two"))
      .mockResolvedValueOnce(Response.json({ tasks: [{ id: "one", state: "queued" }, { id: "two", state: "queued" }] }));
    const onStage = vi.fn();
    expect(await submitCommercialGeneration(batch, true, vi.fn(), fetcher, onStage)).toEqual(["one", "two"]);
    expect(onStage).toHaveBeenCalledWith(0, "moderating");
    expect(onStage).toHaveBeenCalledWith(1, "quoting");
    expect(onStage).toHaveBeenCalledWith(1, "submitting");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("generation stage UI", () => {
  const base: GenerationVariant = { id: "one", label: "Variation 1", status: "generating", progress: 0, notes: "Waiting" };
  function render(variant: GenerationVariant, zh = true) { return renderToStaticMarkup(<GenerationTaskProgress variant={variant} zh={zh} />); }
  it("stops at the failing safety check and does not present later stages as complete", () => {
    const preparing = advanceGenerationProgress(undefined, "preparing", 1000);
    const lifecycle = { ...advanceGenerationProgress(preparing, "moderating", 2000), finishedAt: 4000 };
    const html = render({ ...base, status: "failed", lifecycle, error: "提示词审核暂不可用" });
    expect(html).toContain("生成未完成");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("失败");
    expect(html).toContain("未执行");
    expect(html).not.toContain("100%");
    expect(html).toContain("0:03");
  });
  it("shows stale progress and retries without claiming generation failed", () => {
    const html = render({ ...base, lifecycle: { ...advanceGenerationProgress(undefined, "generating"), connection: "error" } });
    expect(html).toContain("状态同步中断");
    expect(html).toContain("后台任务可能仍在运行");
    expect(html).not.toContain("生成未完成");
  });
  it("stops the spinner for legacy tasks without claiming provider cancellation or failure", () => {
    const html = render({ ...base, providerTaskId: "old", trackingStopped: true });
    expect(html).toContain("已停止跟踪，结果待核实");
    expect(html).toContain("未确认");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("未执行");
    expect(html).not.toContain("生成未完成");
  });
  it("does not invent checkpoints for older restored tasks or use their old percent", () => {
    const html = render({ ...base, status: "completed", progress: 100, providerTaskId: "existing" });
    expect(html).toContain("未记录");
    expect(html).toContain("结果就绪");
    expect(html).not.toContain("100%");
  });
  it("renders English and commercial dispatch separately from model execution", () => {
    const lifecycle = { ...advanceGenerationProgress(undefined, "queued"), commercial: true };
    const html = render({ ...base, lifecycle }, false);
    expect(html).toContain("Waiting for dispatch");
    expect(html).toContain("Check cost and media");
    expect(html).toContain("Elapsed");
  });
});
