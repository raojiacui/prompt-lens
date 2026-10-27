import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKieChat } from "@/lib/ai/kie-client";
import { listModels, resolveModelSelection, routeModel } from "@/lib/ai/model-registry";

const completed = (text = "中文结果") => ({ status: "completed", output: [
  { type: "reasoning", summary: [{ type: "summary_text", text: "private reasoning" }] },
  { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] },
] });
const event = (type: string, value: object = {}) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...value })}\r\n\r\n`;
const input = { apiKey: "test-key", modelId: "deepseek-v4-1-flash", messages: [{ role: "system", content: "JSON only" }, { role: "user", content: [
  { type: "text", text: "Analyze" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,ONE" } },
  { type: "image_url", image_url: { url: "https://media.example/second.jpg" } },
] }] };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("additive V2 DeepSeek analysis", () => {
  it("adds a manual image model while preserving all existing automatic routes", () => {
    expect(listModels("analysis").filter(model => model.enabled)).toEqual(expect.arrayContaining([expect.objectContaining({ id: "analysis-deepseek-v4-1-flash", kieModelId: "deepseek-v4-1-flash" })]));
    expect(resolveModelSelection("analysis", { mode: "manual", modelId: "analysis-deepseek-v4-1-flash" }).model.capabilities).toEqual(["text", "image"]);
    for (const priority of ["balanced", "fast", "best_quality", "lowest_cost"] as const) expect(routeModel({ category: "analysis", priority })?.id).toBe("analysis-gemini-3-8-flash");
    expect(resolveModelSelection("analysis", { mode: "manual", modelId: "gemini-3-8-flash-openai" }).model.kieModelId).toBe("gemini-3-8-flash-openai");
  });
  it("sends system text and images using Responses, excluding reasoning from the final result", async () => {
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json(completed())); vi.stubGlobal("fetch", fetcher);
    expect(await requestKieChat(input)).toBe("中文结果");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.kie.ai/openai/v1/responses");
    const sent = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(sent).toMatchObject({ model: input.modelId, stream: true, reasoning: { effort: "none" }, input: [
      { role: "system", content: [{ type: "input_text", text: "JSON only" }] },
      { role: "user", content: [{ type: "input_text", text: "Analyze" }, { type: "input_image", image_url: "data:image/jpeg;base64,ONE" }, { type: "input_image", image_url: "https://media.example/second.jpg" }] },
    ] });
    expect(sent).not.toHaveProperty("messages");
  });
  it("finishes at response.completed even if the transport stays open, without duplicating text", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(event("response.output_text.delta", { delta: "中文" }) + event("response.output_text.delta", { delta: "结果" }) + event("response.completed", { response: completed() }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); }, cancel });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } })));
    await expect(requestKieChat({ ...input, timeoutMs: 1000 })).resolves.toBe("中文结果");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("keeps a lost Responses result unknown and never resubmits inference", async () => {
    const fetcher = vi.fn(async () => new Response(event("response.output_text.delta", { delta: "partial" }) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestKieChat(input)).rejects.toMatchObject({ outcome: "unknown", modelId: input.modelId });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([401, 402, 429, 503])("handles provider code %s inside HTTP 200 without resubmitting", async code => {
    const fetcher = vi.fn(async () => Response.json({ code, msg: "Provider rejected request" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestKieChat(input)).rejects.toMatchObject({ providerCode: code, outcome: code < 500 ? "confirmed_failure" : "unknown" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("bounds a stalled Responses stream without submitting another paid request", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = expect(requestKieChat({ ...input, timeoutMs: 100 })).rejects.toMatchObject({ outcome: "unknown", modelId: input.modelId });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["response.failed", "response.incomplete"])("rejects %s after partial output", async type => {
    const fetcher = vi.fn(async () => new Response(event("response.output_text.delta", { delta: "partial" }) + event(type, { response: { status: type.split(".")[1], error: { code: 503, message: "Unavailable" } } }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestKieChat(input)).rejects.toMatchObject({ outcome: "unknown", providerCode: 503 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects incomplete JSON output and direct video input", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...completed("partial"), status: "incomplete" })); vi.stubGlobal("fetch", fetcher);
    await expect(requestKieChat(input)).rejects.toMatchObject({ outcome: "unknown" });
    await expect(requestKieChat({ ...input, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://media.example/video.mp4" } }] }] })).rejects.toMatchObject({ outcome: "not_sent" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
