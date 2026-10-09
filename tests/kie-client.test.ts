import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKieChat } from "@/lib/ai/kie-client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("KIE transport", () => {
  const input = { apiKey: "test", modelId: "gemini-3-8-flash-openai", messages: [{ role: "user", content: "test" }] };
  it("uses the model-specific endpoint and normalizes the response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestKieChat(input)).toBe("answer");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gemini-3-8-flash-openai/v1/chat/completions"), expect.objectContaining({ body: JSON.stringify({ messages: input.messages }) }));
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
    const fetchMock = vi.fn(async () => stage === "connection" ? await new Promise<Response>(() => {}) : { ok: true, status: 200, json: () => new Promise(() => {}) });
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
