import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKieChat } from "@/lib/ai/kie-client";

afterEach(() => vi.unstubAllGlobals());
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
});
