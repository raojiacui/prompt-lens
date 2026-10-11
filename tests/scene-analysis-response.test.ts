import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSceneBlueprint } from "@/lib/workflow/scene-analysis";

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
afterEach(() => vi.unstubAllGlobals());
describe("scene analysis response compatibility", () => {
  it("does not repeat a platform-paid scene after an ambiguous KIE 524", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response("gateway timeout", { status: 524 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, analysisKeySource: "platform", analysisApiKey: "test-key" });
    expect(result.metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown", failureCode: "KIE_OUTCOME_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not repeat a KIE 524 when the user supplies the key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("gateway timeout", { status: 524 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, analysisKeySource: "user" });
    expect(result.metadata?.fallbackReason).toBe("KIE API error (524)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not repeat an ambiguous platform network failure", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint({ ...input, analysisKeySource: "platform", analysisApiKey: "test-key" });
    expect(result.metadata).toMatchObject({ analysisProvider: "fallback", providerOutcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("preserves the underlying connection failure without another inference request", async () => {
    const cause = Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeSceneBlueprint(input);
    expect(result.metadata).toMatchObject({ analysisProvider: "fallback", analysisError: { name: "TypeError", message: "fetch failed", cause: { code: "UND_ERR_CONNECT_TIMEOUT" } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
