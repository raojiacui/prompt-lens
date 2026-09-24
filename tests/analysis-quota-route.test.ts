import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUserTrialUsage: vi.fn(),
  getUsableUserAnalyzeApiKeyProvider: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/usage/trial-quota", () => ({
  getUserTrialUsage: mocks.getUserTrialUsage,
  getUsableUserAnalyzeApiKeyProvider: mocks.getUsableUserAnalyzeApiKeyProvider,
}));

import { GET } from "@/app/api/analyze/quota/route";

describe("analysis quota route", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getUsableUserAnalyzeApiKeyProvider.mockResolvedValue(null);
  });

  it("reports exhausted platform quota and whether a personal KIE key exists", async () => {
    mocks.getUserTrialUsage.mockResolvedValue({ limit: 2, used: 2, remaining: 0, isAdmin: false });
    mocks.getUsableUserAnalyzeApiKeyProvider.mockResolvedValue("kie");

    const response = await GET(new NextRequest("http://localhost/api/analyze/quota"));
    expect(await response.json()).toEqual({
      limit: 2,
      used: 2,
      remaining: 0,
      isAdmin: false,
      hasOwnApiKey: true,
    });
  });

  it("serializes administrator access without an invalid Infinity value", async () => {
    mocks.getUserTrialUsage.mockResolvedValue({ limit: 2, used: 0, remaining: Number.POSITIVE_INFINITY, isAdmin: true });

    const response = await GET(new NextRequest("http://localhost/api/analyze/quota"));
    expect(await response.json()).toMatchObject({ isAdmin: true, remaining: null });
  });
});
