import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKieChat } from "@/lib/ai/kie-client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("KIE transport", () => {
  const input = { apiKey: "test", modelId: "gemini-3-8-flash-openai", messages: [{ role: "user", content: "test" }] };
  it("uses the native Gemini 3.8 endpoint and normalizes the response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat(input)).toBe("answer");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gemini/v1/models/gemini-3-8-flash:streamGenerateContent"), expect.objectContaining({ body: JSON.stringify({ stream: true, contents: [{ role: "user", parts: [{ text: "test" }] }] }) }));
  });
  it("keeps other models on their documented compatibility endpoints", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat({ ...input, modelId: "gemini-2.5-flash" })).toBe("answer");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gemini-2.5-flash/v1/chat/completions"), expect.objectContaining({ body: JSON.stringify({ messages: input.messages }) }));
  });
  it("converts image and system messages and joins streamed answer chunks without thoughts", async () => {
    const events = [
      { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "中文" }] } }] },
      { candidates: [{ content: { parts: [{ text: "结果" }] } }] },
      { usageMetadata: { totalTokenCount: 10 }, credits_consumed: 0.01 },
    ];
    const body = events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n";
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat({ ...input, messages: [{ role: "system", content: "JSON only" }, { role: "user", content: [{ type: "text", text: "Analyze" }, { type: "image_url", image_url: { url: "https://example.com/keyframe.jpg" } }] }] })).toBe("中文结果");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ systemInstruction: { parts: [{ text: "JSON only" }] }, contents: [{ role: "user", parts: [{ text: "Analyze" }, { fileData: { mimeType: "image/jpeg", fileUri: "https://example.com/keyframe.jpg" } }] }] });
  });
  it("rejects a truncated stream instead of accepting partial analysis", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } })));
    await expect(requestKieChat(input)).rejects.toThrow("streaming response was interrupted");
  });
  it("preserves provider errors received inside a stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"code":500,"msg":"provider error"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } })));
    await expect(requestKieChat(input)).rejects.toThrow("provider error");
  });
  it("does not repeat a rejected inference request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ msg: "channel unavailable" }), { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestKieChat(input)).rejects.toMatchObject({ status: 422, message: "channel unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects successful HTTP responses with no analysis text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await expect(requestKieChat(input)).rejects.toThrow("empty result");
  });
  it.each(["connection", "body"])("bounds a stalled %s without repeating inference", async stage => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => stage === "connection" ? await new Promise<Response>(() => {}) : { ok: true, status: 200, headers: new Headers({ "Content-Type": "text/event-stream" }), text: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetchMock);
    const request = requestKieChat({ ...input, timeoutMs: 100 });
    const rejected = expect(request).rejects.toThrow("KIE_ANALYSIS_TIMEOUT");
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("recognizes a provider error inside an HTTP 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 500, msg: "upstream unavailable" }))));
    await expect(requestKieChat(input)).rejects.toThrow("upstream unavailable");
  });
});
