import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKieChat } from "@/lib/ai/kie-client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("KIE transport", () => {
  const input = { apiKey: "test", modelId: "gemini-3-8-flash-openai", messages: [{ role: "user", content: "test" }] };
  it.each(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])("retries %s before any inference reaches the server", async code => {
    const cause = Object.assign(new Error("connection unavailable"), { code });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed", { cause }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "answer" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat(input)).toBe("answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });
  it("stops after two unopened connections and reports that inference was not sent", async () => {
    const cause = Object.assign(new Error("connection unavailable"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestKieChat(input)).rejects.toMatchObject({ outcome: "not_sent", cause: { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not retry a socket reset that may follow submission", async () => {
    const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestKieChat(input)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps a mixed aggregate transport failure unknown", async () => {
    const cause = new AggregateError([Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), Object.assign(new Error("reset"), { code: "ECONNRESET" })]);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestKieChat(input)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps both connection attempts inside one request deadline", async () => {
    vi.useFakeTimers();
    const cause = Object.assign(new Error("connection unavailable"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed", { cause })).mockImplementationOnce(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const request = requestKieChat({ ...input, timeoutMs: 100 });
    const rejected = expect(request).rejects.toMatchObject({ outcome: "unknown", message: expect.stringContaining("KIE_ANALYSIS_TIMEOUT") });
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["3-5", "3-6", "3-7", "3-8"])("uses the native Gemini %s endpoint and normalizes the response", async version => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat({ ...input, modelId: `gemini-${version}-flash-openai` })).toBe("answer");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/gemini/v1/models/gemini-${version}-flash:streamGenerateContent`), expect.objectContaining({ body: JSON.stringify({ stream: true, contents: [{ role: "user", parts: [{ text: "test" }] }] }) }));
  });
  it("keeps other models on their documented compatibility endpoints", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat({ ...input, modelId: "gpt-5-2" })).toBe("answer");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gpt-5-2/v1/chat/completions"), expect.objectContaining({ body: JSON.stringify({ messages: input.messages }) }));
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
  it.each(["text/event-stream", "application/json"])("marks a %s body read error as an unknown provider outcome", async contentType => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(contentType === "application/json" ? "{\"candidates\":" : "data: {\"candidates\":"));
      controller.error(new TypeError("terminated"));
    } });
    const fetchMock = vi.fn(async () => new Response(body, { headers: { "Content-Type": contentType } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestKieChat(input)).rejects.toMatchObject({ name: "KieRequestError", outcome: "unknown", cause: { message: "terminated" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("finishes at DONE even when the transport remains open", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"完整结果"}]}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); }, cancel });
    const fetchMock = vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestKieChat({ ...input, timeoutMs: 100 })).resolves.toBe("完整结果");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetchMock = vi.fn(async () => stage === "connection" ? await new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const request = requestKieChat({ ...input, timeoutMs: 100 });
    const rejected = expect(request).rejects.toThrow(`KIE_ANALYSIS_TIMEOUT: ${stage === "connection" ? "connecting" : "reading_response"}`);
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("allows a slow analysis response within the explicit three-minute deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 100_000));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = requestKieChat({ ...input, timeoutMs: 180_000 });
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(request).resolves.toBe("answer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("recognizes a provider error inside an HTTP 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 500, msg: "upstream unavailable" }))));
    await expect(requestKieChat(input)).rejects.toThrow("upstream unavailable");
  });
});
