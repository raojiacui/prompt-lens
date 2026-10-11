import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), findFirst: vi.fn(), runCommercialTask: vi.fn(), runAnalysisTask: vi.fn(), recover: vi.fn(),
}));
vi.mock("next/server", async importOriginal => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/db", () => ({ commercialTasks: { id: "id" }, db: { query: { commercialTasks: { findFirst: mocks.findFirst } } } }));
vi.mock("@/lib/billing/commercial-task-runner", () => ({ runCommercialTask: mocks.runCommercialTask }));
vi.mock("@/lib/workflow/analysis-tasks", () => ({ runAnalysisTask: mocks.runAnalysisTask }));
vi.mock("@/lib/billing/commercial-analysis", () => ({ recoverCommercialAnalysisTasks: mocks.recover }));
vi.mock("@/lib/billing/analysis-execution", () => ({ analysisNeedsRecovery: () => false }));

import { POST } from "@/app/api/internal/analysis-run/route";

afterEach(() => { vi.unstubAllEnvs(); Object.values(mocks).forEach(mock => mock.mockReset()); });

describe("internal analysis dispatch", () => {
  it("acknowledges immediately and loads the queued task in the background", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const id = "59593254-1819-4e2e-8600-c3bebff86669";
    mocks.findFirst.mockResolvedValue({ id, kind: "analysis", state: "queued" });
    const request = new NextRequest("http://localhost/api/internal/analysis-run", { method: "POST", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, body: JSON.stringify({ taskId: id }) });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.runCommercialTask).toHaveBeenCalledWith(id);
  });
});
