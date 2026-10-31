import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      userApiKeys: { findMany },
    },
  },
  analysisHistory: {},
  operationLogs: {},
  user: {},
  userApiKeys: {},
}));

vi.mock("@/lib/utils/encryption", () => ({
  decryptApiKey: vi.fn((value: string) => value),
  isValidEncryptedKey: vi.fn(() => false),
}));

import { describeAnalysisProviderError } from "@/lib/ai/provider-error";
import { JsonHttpError } from "@/lib/http/json-client";
import { KieApiError } from "@/lib/ai/kie-chat-response";
import {
  getUsableUserAnalyzeApiKeyProvider,
  resolveTrialAccess,
} from "@/lib/usage/trial-quota";

describe("analysis provider authentication", () => {
  it.each([503, 504, 524, 500, 429])("explains KIE %s failures and offers a model switch", status => {
    expect(describeAnalysisProviderError("kie", new KieApiError(status, "Service Unavailable"))).toContain("切换其他模型");
    expect(describeAnalysisProviderError("kie", new KieApiError(status, "Service Unavailable"), "en")).toContain("switching");
  });
  it("explains final KIE timeouts without blaming unrelated failures on its gateway", () => {
    expect(describeAnalysisProviderError("kie", new Error("KIE request timed out after 2 attempts"))).toContain("上游网关");
    for (const error of [new KieApiError(524, "Failed to download fileData.fileUri: HTTP 404"), new KieApiError(401, "Unauthorized"), new Error("Database save failed")]) {
      expect(describeAnalysisProviderError("kie", error)).not.toContain("上游网关");
    }
  });
  beforeEach(() => {
    findMany.mockReset();
  });

  it("does not switch away from the provider selected by the user", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ apiKey: "saved-kie-key" }]);

    await expect(
      getUsableUserAnalyzeApiKeyProvider("user-1", "openrouter"),
    ).resolves.toBeNull();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("turns KIE 401 responses into an actionable message", () => {
    const error = new JsonHttpError(401, { msg: "Unauthorized" }, "Unauthorized");

    expect(describeAnalysisProviderError("kie", error)).toContain(
      "IP 白名单",
    );
  });

  it("gives administrators unlimited platform OpenRouter access", () => {
    expect(resolveTrialAccess("admin", 99, 2)).toEqual({
      limit: 2,
      used: 0,
      remaining: Number.POSITIVE_INFINITY,
      isAdmin: true,
      hasOwnApiKey: false,
      apiKeySource: "platform",
    });
  });

  it("limits regular users to two platform OpenRouter analyses", () => {
    expect(resolveTrialAccess("user", 1, 2)).toMatchObject({
      used: 1,
      remaining: 1,
      isAdmin: false,
      apiKeySource: "platform",
    });
  });
});
