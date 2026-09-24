import axios from "axios";
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
import { getUsableUserAnalyzeApiKeyProvider } from "@/lib/usage/trial-quota";

describe("analysis provider authentication", () => {
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
    const error = new axios.AxiosError(
      "Request failed with status code 401",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      { status: 401, data: { msg: "Unauthorized" } } as never,
    );

    expect(describeAnalysisProviderError("kie", error)).toContain(
      "IP 白名单",
    );
  });
});
