import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/commercial/image-analysis/route";
const fixture = vi.hoisted(() => ({ user: { id: "owner" } as { id: string } | null, allowed: true, quote: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: fixture.user }) } } }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: fixture.allowed }) }));
vi.mock("@/lib/workflow/analysis-tasks", () => ({ quoteImageAnalysis: fixture.quote }));
const input = { projectId: "11111111-1111-4111-8111-111111111111", mediaUrl: "https://storage.test/a.png", modelId: "analysis-deepseek-v4-1-flash" };
function call(body: unknown = input, origin = "https://fixture.test") { return POST(new NextRequest("https://fixture.test/api/commercial/image-analysis", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) })); }
beforeEach(() => { fixture.user = { id: "owner" }; fixture.allowed = true; fixture.quote.mockReset().mockResolvedValue({ id: "quote", credits: 2 }); });
it("quotes only for the authenticated user", async () => {
  expect((await call()).status).toBe(200);
  expect(fixture.quote).toHaveBeenCalledWith("owner", input);
});
it("rejects unauthenticated, cross-origin, malformed and rate-limited requests before quoting", async () => {
  fixture.user = null; expect((await call()).status).toBe(401);
  fixture.user = { id: "owner" }; expect((await call(input, "https://other.test")).status).toBe(403);
  expect((await call({ ...input, projectId: "bad" })).status).toBe(400);
  fixture.allowed = false; expect((await call()).status).toBe(429);
  expect(fixture.quote).not.toHaveBeenCalled();
});
it("redacts an unexpected storage failure", async () => {
  fixture.quote.mockRejectedValueOnce(new Error("storage failed secret-value"));
  const response = await call();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "IMAGE_QUOTE_UNAVAILABLE" });
});
