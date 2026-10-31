import { describe, expect, it, vi } from "vitest";
import { buildKieAnalysisRequest } from "@/lib/ai/kie-analysis-request";
import { requestKieChatCompletion } from "@/lib/ai/kie-chat-client";
import { parseKieChatResponse, parseKieChatEventStream } from "@/lib/ai/kie-chat-response";
import { resolveAnalysisModel } from "@/lib/ai/analysis-models";

const completed = (text: string) => ({ status: "completed", output: [
  { type: "reasoning", summary: [{ type: "summary_text", text: "private reasoning" }] },
  { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] },
] });
const event = (type: string, value: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;

describe("DeepSeek image analysis over KIE Responses", () => {
  it("sends Gemini 3.8 frames to its own channel and reads its answer", async () => {
    const request = buildKieAnalysisRequest("gemini-3-8-flash", ["data:image/jpeg;base64,TEST"], "Analyze");
    expect(request.path).toBe("/gemini-3-8-flash-openai/v1/chat/completions");
    expect(request.payload).toMatchObject({ model: "gemini-3-8-flash", messages: [{ content: [
      { type: "text", text: "Analyze" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,TEST" } },
    ] }] });
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: "Gemini result" } }] }));
    expect(await requestKieChatCompletion({ url: `https://api.kie.ai${request.path}`, apiKey: "test", payload: request.payload, fetcher })).toBe("Gemini result");
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it.each(["platform-deepseek-v4-flash", "kie-deepseek-v4-flash"])("routes %s to Responses and preserves all image inputs", (id) => {
    const selected = resolveAnalysisModel(id)!;
    const images = ["data:image/jpeg;base64,ONE", "data:image/jpeg;base64,TWO"];
    const request = buildKieAnalysisRequest(selected.providerModel, images, "Analyze these frames");
    expect(request).toEqual({ path: "/openai/v1/responses", payload: {
      model: "deepseek-v4-1-flash", reasoning: { effort: "none" }, input: [{ role: "user", content: [
        { type: "input_text", text: "Analyze these frames" },
        ...images.map((image_url) => ({ type: "input_image", image_url })),
      ] }],
    } });
    expect(selected.keySource).toBe(id.startsWith("platform") ? "platform" : "user");
  });

  it("keeps the other Gemini channels on chat completions", () => {
    const request = buildKieAnalysisRequest("gemini-2.5-pro", ["frame"], "Analyze");
    expect(request.path).toBe("/gemini-2.5-pro/v1/chat/completions");
    expect(request.payload).toMatchObject({ messages: [{ role: "user", content: [
      { type: "text", text: "Analyze" }, { type: "image_url", image_url: { url: "frame" } },
    ] }] });
    expect(request.payload).not.toHaveProperty("input");
  });

  it("returns assistant output without the reasoning summary", () => {
    expect(parseKieChatResponse(completed("analysis result"))).toBe("analysis result");
    expect(parseKieChatResponse({ code: 200, data: completed("wrapped result") })).toBe("wrapped result");
  });

  it("uses the final snapshot without duplicating streamed text", () => {
    const stream = event("response.output_text.delta", { delta: "analysis" })
      + event("response.output_text.delta", { delta: " result" })
      + event("response.completed", { response: completed("analysis result") });
    expect(parseKieChatEventStream(stream)).toBe("analysis result");
  });

  it("assembles deltas when the completion event has no output snapshot", () => {
    expect(parseKieChatEventStream(event("response.output_text.delta", { delta: "result" })
      + event("response.completed", { response: { status: "completed" } }))).toBe("result");
  });

  it.each(["incomplete", "failed", "cancelled", "in_progress"])("rejects a %s JSON result even when it contains text", (status) => {
    expect(() => parseKieChatResponse({ ...completed("partial"), status })).toThrow();
  });

  it("rejects a truncated stream instead of saving partial text", () => {
    expect(() => parseKieChatEventStream(event("response.output_text.delta", { delta: "partial" }) + "data: [DONE]\n\n"))
      .toThrow("before completion");
  });

  it.each(["response.failed", "response.incomplete"])("rejects %s after partial output", (type) => {
    expect(() => parseKieChatEventStream(event("response.output_text.delta", { delta: "partial" })
      + event(type, { response: { status: type.split(".")[1], error: { code: 503, message: "Unavailable" } } })))
      .toThrow("503");
  });

  it("surfaces top-level stream error events", () => {
    expect(() => parseKieChatEventStream(event("error", { message: "Invalid input" }))).toThrow("Invalid input");
  });

  it("sends the new protocol and retries a streamed 503 before returning the completed analysis", async () => {
    const { path, payload } = buildKieAnalysisRequest("deepseek-v4-1-flash", ["data:image/jpeg;base64,TEST"], "Analyze");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(event("response.failed", { response: { status: "failed", error: { code: 503, message: "Unavailable" } } }), { headers: { "Content-Type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(event("response.completed", { response: completed("analysis") }), { headers: { "Content-Type": "text/event-stream" } }));
    expect(await requestKieChatCompletion({ url: `https://api.kie.ai${path}`, apiKey: "test", payload, fetcher, delay: async () => {} })).toBe("analysis");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(sent).toMatchObject({ model: "deepseek-v4-1-flash", stream: true, input: [{ content: [{ type: "input_text" }, { type: "input_image" }] }] });
    expect(sent).not.toHaveProperty("messages");
  });
});
