import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AnalysisFrameInputError } from "@/lib/ai/analysis-frame-input";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), analyze: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "user-1" } }) } } }));
vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: () => ({ returning: async () => [{ id: "history-1" }] }) }) },
  analysisHistory: {}, operationLogs: {},
}));
vi.mock("@/lib/usage/trial-quota", () => ({
  getUsableUserAnalyzeApiKeyProvider: async () => "kie", assertTrialQuota: vi.fn(), trialQuotaResponse: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true }), RateLimitConfigs: { analyze: { limit: 10, windowMs: 60000 } },
}));
vi.mock("@/lib/ai/analyzer", () => ({ analyzeFrames: mocks.analyze }));
vi.mock("@/lib/ai/analysis-frame-access", () => ({ prepareAnalysisFrames: mocks.prepare }));
vi.mock("@/lib/cloudflare/r2", () => ({
  extractR2Key: (url: string) => url.replace("https://media.example/", ""), deleteFromR2: mocks.remove,
}));
import { POST } from "@/app/api/analyze/route";

const key = "analysis-frames/user-1/run-1/frame-01.jpg";
const request = () => new NextRequest("https://site.example/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
  mediaUrl: "https://media.example/video.mp4", mediaType: "video", frameUrls: [`https://media.example/${key}`], analysisModel: "kie-gemini-3.8-flash",
}) });

describe("analysis frame lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue(["data:image/jpeg;base64,/9j/4AE="]);
    mocks.analyze.mockResolvedValue({ success: true, prompt: "result", corePrompt: "core" });
    mocks.remove.mockResolvedValue(undefined);
  });

  it("passes verified inline frames to inference and deletes frames only after completion", async () => {
    mocks.analyze.mockImplementation(async ({ frames, model }) => {
      expect(model).toBe("deepseek-v4-1-flash");
      expect(frames).toEqual(["data:image/jpeg;base64,/9j/4AE="]);
      expect(mocks.remove).not.toHaveBeenCalled();
      return { success: true, prompt: "result", corePrompt: "core" };
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith([key]);
    expect(mocks.remove).toHaveBeenCalledWith(key);
  });

  it("does not call KIE or consume an analysis when an uploaded frame is missing", async () => {
    mocks.prepare.mockRejectedValueOnce(new AnalysisFrameInputError("分析帧已丢失，请重新上传"));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "ANALYSIS_FRAME_UNAVAILABLE" });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});
