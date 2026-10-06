import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ expire: vi.fn(), cleanup: vi.fn(), generation: vi.fn() }));
vi.mock("@/lib/workflow/media-retention", () => ({ expireProjectMedia: mocks.expire }));
vi.mock("@/lib/workflow/media-cleanup", () => ({ processMediaCleanupJobs: mocks.cleanup }));
vi.mock("@/lib/workflow/generation-retention", () => ({ expireGenerationHistory: mocks.generation }));
import { GET } from "@/app/api/cron/media-retention/route";

describe("protected retention scheduler", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("rejects requests without the scheduler secret", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect((await GET(new NextRequest("http://localhost/api/cron/media-retention"))).status).toBe(401);
    expect(mocks.expire).not.toHaveBeenCalled();
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new NextRequest("http://localhost/api/cron/media-retention", { headers: { authorization: "Bearer " } }))).status).toBe(401);
  });
  it("supports a read-only preview and bounded scheduled cleanup", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    mocks.expire.mockResolvedValue({ eligible: 2, expired: 0 });
    const headers = { authorization: "Bearer test-secret" };
    await GET(new NextRequest("http://localhost/api/cron/media-retention?dryRun=1", { headers }));
    expect(mocks.expire).toHaveBeenCalledWith(10, true);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.generation).not.toHaveBeenCalled();
    mocks.cleanup.mockResolvedValue(3);
    mocks.generation.mockResolvedValue({ expiredGenerations: 1 });
    await GET(new NextRequest("http://localhost/api/cron/media-retention", { headers }));
    expect(mocks.expire).toHaveBeenCalledWith(10, false);
    expect(mocks.cleanup).toHaveBeenCalledWith(50);
    expect(mocks.generation).toHaveBeenCalledOnce();
  });
});
