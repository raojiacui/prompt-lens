import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), models: vi.fn(), limit: vi.fn(), transaction: vi.fn(), findMany: vi.fn(), insert: vi.fn(), update: vi.fn(), encrypt: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/ai/infistar-client", () => ({ listInfistarModels: mocks.models }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/utils/encryption", () => ({ encryptApiKey: mocks.encrypt, decryptApiKey: vi.fn(), isValidEncryptedKey: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { transaction: mocks.transaction } }));
import { POST } from "@/app/api/settings/api-key/route";

const key = "fake-provider-key-long-enough";
const request = (body: unknown, origin = "https://test.example") => new NextRequest("https://test.example/api/settings/api-key", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.models.mockResolvedValue([]);
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.findMany.mockResolvedValue([]);
  mocks.encrypt.mockReturnValue("encrypted-fixture");
  mocks.transaction.mockImplementation(async callback => callback({ execute: vi.fn(), query: { userApiKeys: { findMany: mocks.findMany } }, insert: () => ({ values: mocks.insert }), update: () => ({ set: (values: unknown) => ({ where: () => mocks.update(values) }) }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("rejects cross-origin requests before accessing keys or calling providers", async () => {
  expect((await POST(request({ provider: "infistar", apiKey: key }, "https://other.example"))).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.models).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("requires authentication", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await POST(request({ provider: "infistar", apiKey: key }))).status).toBe(401);
  expect(mocks.models).not.toHaveBeenCalled();
});
it("rejects invalid keys and unsupported providers before network validation", async () => {
  expect((await POST(request({ provider: "other", apiKey: key }))).status).toBe(400);
  expect((await POST(request({ provider: "infistar", apiKey: "short" }))).status).toBe(400);
  expect((await POST(request(null))).status).toBe(400);
  expect(mocks.models).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("rate limits save verification without calling a provider or changing stored keys", async () => {
  mocks.limit.mockResolvedValue({ allowed: false });
  const response = await POST(request({ provider: "infistar", apiKey: key }));
  expect(response.status).toBe(429);
  expect(mocks.models).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("waits for fresh provider verification before encrypting or starting the save transaction", async () => {
  let verified!: (value: unknown) => void;
  mocks.models.mockImplementation(() => new Promise(resolve => { verified = resolve; }));
  const saving = POST(request({ provider: "infistar", apiKey: ` ${key} ` }));
  await vi.waitFor(() => expect(mocks.models).toHaveBeenCalledWith(key, { refresh: true }));
  expect(mocks.encrypt).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  verified([]);
  const response = await saving;
  expect(response.status).toBe(200);
  expect(mocks.insert).toHaveBeenCalledWith({ userId: "owner", provider: "infistar", apiKey: "encrypted-fixture", isActive: true });
  expect(JSON.stringify(await response.json())).not.toContain(key);
});
it.each([new Error("Invalid private-key-fixture"), new DOMException("Timeout private-key-fixture", "TimeoutError")])("keeps an existing key untouched when verification fails: %s", async error => {
  mocks.findMany.mockResolvedValue([{ id: "saved", apiKey: "old-ciphertext" }]);
  mocks.models.mockRejectedValue(error);
  const response = await POST(request({ provider: "infistar", apiKey: key }));
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.code).toBe("KEY_VALIDATION_FAILED");
  expect(JSON.stringify(body)).not.toContain("private-key-fixture");
  expect(mocks.encrypt).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("replaces an existing key only after successful verification and preserves its preference", async () => {
  mocks.findMany.mockResolvedValue([{ id: "saved", apiKey: "old-ciphertext", isPreferred: true }]);
  expect((await POST(request({ provider: "infistar", apiKey: key }))).status).toBe(200);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith({ apiKey: "encrypted-fixture", isActive: true, updatedAt: expect.any(Date) });
});
it("checks KIE's application status even on HTTP 200 and sanitizes the error", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 401, msg: "private-upstream-fixture" }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(request({ provider: "kie", apiKey: key }));
  expect(response.status).toBe(400);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.kie.ai/api/v1/chat/credit");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
  expect(mocks.models).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(JSON.stringify(await response.json())).not.toContain("private-upstream");
});
it("saves an authenticated KIE key with zero balance using only its read-only endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 200, data: 0 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await POST(request({ apiKey: key }))).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  expect(mocks.models).not.toHaveBeenCalled();
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ provider: "kie" }));
});
