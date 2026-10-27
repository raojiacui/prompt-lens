import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/billing/commercial-analysis", () => ({ commercialConsumptionEnabled: () => true,
  prepareCommercialAnalysis: mocks.prepare, quoteCommercialAnalysis: vi.fn(), quoteCommercialAnalysisRetry: vi.fn() }));
import { POST } from "@/app/api/commercial/analysis/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "test-user" } });
});
afterEach(() => vi.restoreAllMocks());
const request = () => new NextRequest("https://test.example/api/commercial/analysis", { method: "POST", headers: { Origin: "https://test.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", projectId: "project", mediaUrl: "https://media.example/video.mp4" }) });

it.each(["MEDIA_PREPARATION_FAILED", "MEDIA_STORAGE_CONFIG_INVALID", "MEDIA_PROBE_NOT_CONFIGURED"])("reports %s as a service failure and logs sanitized diagnostics", async (code) => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.prepare.mockRejectedValueOnce(new Error(code, { cause: Object.assign(new Error("Invalid URL https://private.example/video?signature=secret"), { code: "MEDIA_HTTP_500" }) }));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code });
  expect(logged).toHaveBeenCalledOnce();
  expect(JSON.stringify(logged.mock.calls)).toContain("MEDIA_HTTP_500");
  expect(JSON.stringify(logged.mock.calls)).not.toContain("signature=secret");
});
it("preserves the authentication boundary before preparing media", async () => {
  mocks.getSession.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("preserves purchase checks instead of converting them into service failures", async () => {
  mocks.prepare.mockRejectedValueOnce(new Error("SPLIT_PAYMENT_REQUIRED"));
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "SPLIT_PAYMENT_REQUIRED" });
});
