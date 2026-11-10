import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn(), models: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: mocks.key }));
vi.mock("@/lib/ai/infistar-client", () => ({ listInfistarModels: mocks.models }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.limit }));
import { POST } from "@/app/api/settings/api-key/test/route";
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "owner" } }); mocks.limit.mockResolvedValue({ allowed: true }); });
afterEach(() => vi.unstubAllGlobals());
const request = (body: unknown, origin = "https://test.example") => new NextRequest("https://test.example/api/settings/api-key/test", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
it("rejects a cross-origin request before accessing credentials", async () => {
  expect((await POST(request({ provider: "infistar" }, "https://other.example"))).status).toBe(403);
  expect(mocks.key).not.toHaveBeenCalled();
});
it("requires an authenticated user", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await POST(request({ provider: "infistar" }))).status).toBe(401);
});
it("tests only the explicitly selected Infistar provider without invoking inference", async () => {
  mocks.models.mockResolvedValue([{ id: "gemini-3.8-flash" }]);
  const response = await POST(request({ provider: "infistar", apiKey: "fake-infistar-key-long-enough" }));
  expect(response.status).toBe(200);
  expect(mocks.models).toHaveBeenCalledWith("fake-infistar-key-long-enough");
  expect(mocks.key).not.toHaveBeenCalled();
  expect(JSON.stringify(await response.json())).not.toContain("fake-infistar");
});
it("pins a saved key lookup to the selected provider", async () => {
  mocks.key.mockResolvedValue({ provider: "infistar", apiKey: "fake-saved-key-long-enough" });
  expect((await POST(request({ provider: "infistar" }))).status).toBe(200);
  expect(mocks.key).toHaveBeenCalledWith("owner", "infistar");
});
it("checks KIE's application status code even when HTTP succeeds", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 401, msg: "sensitive fixture echoed" }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(request({ provider: "kie", apiKey: "fake-kie-key-long-enough" }));
  expect(response.status).toBe(400);
  expect(mocks.models).not.toHaveBeenCalled();
  expect(fetcher.mock.calls[0][0]).toBe("https://api.kie.ai/api/v1/chat/credit");
  expect(JSON.stringify(await response.json())).not.toContain("sensitive fixture");
});
