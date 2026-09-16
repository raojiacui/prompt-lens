import { afterEach, describe, expect, it, vi } from "vitest";
import { rewriteSceneBlueprint, type SceneBlueprintDraft } from "@/lib/workflow/scene-analysis";

vi.mock("@/lib/byok/kie", () => ({ getUserKieApiKey: vi.fn(async () => "test-key") }));
vi.mock("@/lib/billing/platform-access", () => ({ getPlatformKieApiKey: () => "platform-test-key" }));

const original: SceneBlueprintDraft = {
  story: { summary: "女子走过长廊" },
  visual: { characters: "红白汉服女子", action: "裙摆和飘带摆动" },
  dialogue: [], narration: [], subtitle: [], audio: {}, transition: {},
  generationPrompt: "女子穿红白汉服走过云海长廊，裙摆飘动，低机位跟拍。",
};
const candidate = {
  ...original,
  story: { summary: "西装男子走过长廊" },
  visual: { characters: "穿深色西装、长裤与皮鞋的男子", action: "稳步前行，西装衣摆轻动" },
  generationPrompt: "一名穿深色西装、长裤和皮鞋的男子背对镜头，沿云海长廊稳步前行，西装衣摆轻动。低机位广角镜头平滑跟拍，晨光照亮栏杆和地面倒影。",
};
const input = { userId: "test", scene: original, instruction: "把画面中穿汉服的女子换成穿西装的男子", outputLanguage: "zh" as const };
function mockResponses(...values: unknown[]) {
  const fetchMock = vi.fn();
  for (const value of values) fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("semantic scene rewrite", () => {
  it("uses the platform key for every included rewrite call even when BYOK exists", async () => {
    const fetchMock = mockResponses(candidate, { accepted: true, issues: [] });
    await rewriteSceneBlueprint({ ...input, rewriteKeySource: "platform", allowPlatformKeyForRewrite: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(call[1].headers.Authorization).toBe("Bearer platform-test-key");
  });
  it("keeps explicitly selected BYOK calls on the user key", async () => {
    const fetchMock = mockResponses(candidate, { accepted: true, issues: [] });
    await rewriteSceneBlueprint({ ...input, rewriteKeySource: "user", allowPlatformKeyForRewrite: true });
    for (const call of fetchMock.mock.calls) expect(call[1].headers.Authorization).toBe("Bearer test-key");
  });
  it("sends complete context and returns the reviewed new script without old wardrobe", async () => {
    const fetchMock = mockResponses(candidate, { accepted: true, issues: [] });
    const longScene = { ...original, generationPrompt: "长廊".repeat(3000) + "完整提示词末尾" };
    const result = await rewriteSceneBlueprint({ ...input, scene: longScene });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content[0].text).toContain("完整提示词末尾");
    expect(body.messages[1].content[0].text).toContain(input.instruction);
    expect(result.generationPrompt).toBe(candidate.generationPrompt);
    expect(result.visual).toEqual(candidate.visual);
    expect(result.metadata?.rewriteValidated).toBe(true);
  });

  it("repairs a gender-only rewrite when review finds the old costume and movement", async () => {
    const bad = { ...candidate, generationPrompt: "男子穿汉服走过长廊，裙摆飘动。" };
    const fetchMock = mockResponses(bad, { accepted: false, issues: ["服装仍是汉服，动作仍有裙摆"] }, candidate, { accepted: true, issues: [] });
    const result = await rewriteSceneBlueprint(input);
    expect(result.generationPrompt).toContain("西装");
    expect(result.generationPrompt).not.toContain("裙摆");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages[1].content[0].text).toContain("服装仍是汉服");
  });

  it("does not report local word replacement as success when the provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));
    await expect(rewriteSceneBlueprint(input)).rejects.toThrow("原版本已保留");
  });

  it("rejects incomplete or repeatedly unapproved results", async () => {
    mockResponses({ generationPrompt: "男子" }, candidate, { accepted: false, issues: ["未完成用户要求"] });
    await expect(rewriteSceneBlueprint(input)).rejects.toThrow("原版本已保留");
  });
});
