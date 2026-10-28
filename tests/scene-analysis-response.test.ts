import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSceneBlueprint, analyzeImageBlueprint } from "@/lib/workflow/scene-analysis";

vi.mock("@/lib/byok/kie", () => ({ getUserKieApiKey: async () => "test-key" }));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "test-key" }));
const input = {
  userId: "test", modelMode: "manual" as const, modelId: "gemini-3-8-flash-openai",
  scene: { sceneIndex: 1, startTime: 0, endTime: 3.507, duration: 3.507, clipUrl: "https://example.com/clip.mp4", keyframeUrls: ["https://example.com/frame.jpg"] },
  context: { sceneCount: 1 }, outputLanguage: "zh" as const,
};
const response = {
  story: "一只牛仔猫倚靠在列车窗边。",
  visual: { sceneDescription: "猫咪穿皮夹克，背景是列车窗户。", subject: "牛仔猫" },
  generationPrompt: "电影质感中近景，牛仔猫倚靠在列车窗边，暖黄色侧逆光。",
};
function mock(value: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(value) + "\n```" } }] })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("scene analysis response compatibility", () => {
  it("bounds platform-paid scene retries after an ambiguous KIE 524", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementation(async () => new Response("gateway timeout", { status: 524 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, analysisKeySource: "platform", analysisApiKey: "test-key" });
    expect(result.metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown", failureCode: "KIE_OUTCOME_UNKNOWN" });
    expect(result.metadata).toMatchObject({ analysisResultAttempts: 2, providerAttemptUnconfirmed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("also bounds a KIE 524 retry when the user supplies the key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("gateway timeout", { status: 524 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, analysisKeySource: "user" });
    expect(result.metadata?.fallbackReason).toBe("KIE API error (524)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retries an ambiguous platform network failure at most once", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, analysisKeySource: "platform", analysisApiKey: "test-key" });
    expect(result.metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retries an unopened connection once and preserves its final not-sent failure", async () => {
    const cause = Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint(input);
    expect(result.metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "not_sent", failureCode: "KIE_CONNECTION_FAILED", analysisResultAttempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retains a real prompt when the model returns story as a string", async () => {
    const fetchMock = mock(response);
    const result = await analyzeSceneBlueprint(input);
    expect(result.story.summary).toBe(response.story);
    expect(result.generationPrompt).toContain("牛仔猫");
    expect(result.metadata?.analysisProvider).toBe("kie");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).systemInstruction.parts[0].text).toContain("story must be an object");
  });
  it("keeps structured story fields and server timing", async () => {
    mock({ ...response, story: { summary: response.story, beat: "停留" } });
    const result = await analyzeSceneBlueprint(input);
    expect(result.story).toMatchObject({ summary: response.story, beat: "停留", startTime: 0, endTime: 3.507 });
  });
  it.each(["story", "visual", "generationPrompt"])("names the invalid %s field without treating incomplete data as success", async field => {
    const value = { ...response, [field]: null };
    const fetchMock = mock(value);
    const result = await analyzeSceneBlueprint(input);
    expect(result.metadata?.analysisProvider).toBe("fallback");
    expect(result.metadata?.fallbackReason).toContain(`invalid fields ${field}`);
    expect(result.generationPrompt).toBe("");
    expect(result.metadata).toMatchObject({ providerOutcome: "confirmed_failure", failureCode: "KIE_INVALID_RESULT", analysisResultAttempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["", " ", "\u200b", "null", "N/A", "...", "核心提示词：", "```json```"])("recovers an unusable prompt %j with one replacement", async prompt => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ ...response, generationPrompt: prompt }) } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint(input);
    expect(result.metadata).toMatchObject({ analysisProvider: "kie", analysisResultAttempts: 2 });
    expect(result.generationPrompt).toContain("牛仔猫");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]!.body).toBe(fetchMock.mock.calls[1][1]!.body);
  });

  it.each(["empty HTTP answer", "empty completed stream", "invalid scene JSON", "null scene", "empty visual", "timing-only story", "empty DeepSeek completion"])("replaces %s only after a completed response", async kind => {
    const malformed = kind === "invalid scene JSON" ? "{unfinished" : JSON.stringify(kind === "null scene" ? null : kind === "empty visual" ? { ...response, visual: { sceneDescription: " " } } : { ...response, story: { startTime: 0, endTime: 3 } });
    const deepseek = kind.includes("DeepSeek");
    const completed = (text: string) => ({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] });
    const first = kind === "empty HTTP answer" ? Response.json({ choices: [] })
      : kind === "empty completed stream" ? new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } })
      : deepseek ? Response.json(completed("")) : Response.json({ choices: [{ message: { content: malformed } }] });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(first)
      .mockResolvedValueOnce(Response.json(deepseek ? completed(JSON.stringify(response)) : { choices: [{ message: { content: JSON.stringify(response) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, modelId: deepseek ? "analysis-deepseek-v4-1-flash" : input.modelId });
    expect(result.metadata).toMatchObject({ analysisProvider: "kie", analysisResultAttempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries only the two invalid shots in a five-shot analysis", async () => {
    const counts = new Map<number, number>();
    const fetchMock = vi.fn<typeof fetch>(async (_url, options) => {
      const payload = JSON.parse(options!.body as string);
      const sceneIndex = Number(payload.contents[0].parts[0].text.match(/Scene index: (\d+)/)[1]);
      const attempt = (counts.get(sceneIndex) || 0) + 1; counts.set(sceneIndex, attempt);
      if (sceneIndex === 4 && attempt === 1) return new Response("Service Unavailable", { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(attempt === 1 && sceneIndex === 1 ? { ...response, generationPrompt: "" } : response) } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.all([1, 2, 3, 4, 5].map(sceneIndex => analyzeSceneBlueprint({ ...input, scene: { ...input.scene, sceneIndex }, context: { sceneCount: 5 } })));
    expect(results.every(result => result.metadata?.analysisProvider === "kie" && result.generationPrompt.trim())).toBe(true);
    expect([1, 2, 3, 4, 5].map(id => counts.get(id))).toEqual([2, 1, 1, 2, 1]);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it.each([408, 429, 500, 502, 503, 504, 524])("recovers from HTTP %i with one replacement", async status => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("unavailable", { status }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint(input);
    expect(result.metadata).toMatchObject({ analysisProvider: "kie", analysisResultAttempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
    expect(fetchMock.mock.calls[0][1]!.body).toBe(fetchMock.mock.calls[1][1]!.body);
    expect(fetchMock.mock.calls[0][1]!.headers).toEqual(fetchMock.mock.calls[1][1]!.headers);
  });

  it("bounds retries for truncated responses and preserves the unknown outcome", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await analyzeSceneBlueprint(input)).metadata).toMatchObject({ providerOutcome: "unknown", analysisProvider: "fallback" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not add another replacement when the replacement request fails", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ choices: [] })).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await analyzeSceneBlueprint(input)).metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves static image analysis outside the new retry policy", async () => {
    const fetchMock = mock({ ...response, generationPrompt: "" });
    expect((await analyzeImageBlueprint(input)).metadata?.analysisProvider).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries authentication or invalid input errors", async () => {
    for (const status of [400, 401, 403, 404, 405]) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("rejected", { status }));
      vi.stubGlobal("fetch", fetchMock);
      expect((await analyzeSceneBlueprint(input)).metadata).toMatchObject({ analysisProvider: "fallback", analysisResultAttempts: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("retries a first timeout and returns the replacement prompt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Promise<Response>(() => {}))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = analyzeSceneBlueprint(input);
    await vi.advanceTimersByTimeAsync(181_001);
    expect((await pending).metadata).toMatchObject({ analysisProvider: "kie", analysisResultAttempts: 2, providerAttemptUnconfirmed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps two timeouts inside four minutes with no third request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const pending = analyzeSceneBlueprint(input);
    await vi.advanceTimersByTimeAsync(240_001);
    expect((await pending).metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves an earlier unknown outcome when the replacement is complete but invalid", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await analyzeSceneBlueprint(input)).metadata).toMatchObject({ analysisProvider: "fallback", failureCode: "KIE_INVALID_RESULT", providerOutcome: "unknown", providerAttemptUnconfirmed: true, analysisResultAttempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers a DeepSeek provider 500 inside HTTP 200 and keeps the original request unconfirmed", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 500, msg: "upstream timeout" }))
      .mockResolvedValueOnce(Response.json({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(response) }] }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await analyzeSceneBlueprint({ ...input, modelId: "analysis-deepseek-v4-1-flash" })).metadata)
      .toMatchObject({ analysisProvider: "kie", analysisResultAttempts: 2, providerAttemptUnconfirmed: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
  });
});
