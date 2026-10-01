import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeToolContext } from "./agent-test-utils";

const mocks = vi.hoisted(() => ({
  userKey: vi.fn(),
  createProvider: vi.fn(),
  createTask: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/ai/video-generator", () => ({ getUserProviderApiKey: mocks.userKey }));
vi.mock("@/lib/ai/video-provider", () => ({
  DEFAULT_VIDEO_PROVIDER: "kie",
  createVideoProvider: mocks.createProvider,
}));

import { callExistingVideoGenerateApiTool } from "@/lib/agent/tools/call-existing-video-generate-api";

describe("Agent generation spending boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("KIE_API_KEY", "platform-secret-test-only");
    vi.stubEnv("KIE_AI_API_KEY", "platform-alias-test-only");
    mocks.rateLimit.mockResolvedValue({ allowed: true, resetIn: 0 });
    mocks.createTask.mockResolvedValue({ taskId: "byok-task", raw: {} });
    mocks.createProvider.mockReturnValue({ createTask: mocks.createTask });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["false", "true"])("never falls back to platform keys with commercial mode %s", async (enabled) => {
    vi.stubEnv("COMMERCIAL_CONSUMPTION_ENABLED", enabled);
    mocks.userKey.mockResolvedValue(undefined);
    const result = await callExistingVideoGenerateApiTool.execute({ prompt: "A cloud palace" }, makeToolContext());
    expect(result.data).toMatchObject({ created: false, reason: "no_api_key" });
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("uses only the explicitly saved personal key", async () => {
    mocks.userKey.mockResolvedValue("personal-key-test-only");
    const result = await callExistingVideoGenerateApiTool.execute({ prompt: "A cloud palace" }, makeToolContext());
    expect(result.data).toMatchObject({ created: true, taskId: "byok-task" });
    expect(mocks.createProvider).toHaveBeenCalledWith("kie", "personal-key-test-only");
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it("does not generate when personal key lookup fails", async () => {
    mocks.userKey.mockRejectedValue(new Error("KEY_LOOKUP_FAILED"));
    const result = await callExistingVideoGenerateApiTool.execute({ prompt: "A cloud palace" }, makeToolContext());
    expect(result.data).toMatchObject({ created: false });
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
