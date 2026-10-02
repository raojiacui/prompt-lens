import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ session: vi.fn(), keys: vi.fn(), key: vi.fn(), history: vi.fn(), count: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/utils/encryption", () => ({ isValidEncryptedKey: () => true, decryptApiKey: () => "alice-private-api-secret-12345678", encryptApiKey: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { ...schema, db: { query: { userApiKeys: { findMany: mocks.keys, findFirst: mocks.key }, analysisHistory: { findMany: mocks.history } }, select: () => ({ from: () => ({ where: mocks.count }) }), delete: () => ({ where: mocks.remove }) } };
});
import { GET as getKeys, DELETE as deleteKey } from "@/app/api/settings/api-key/route";
import { GET as getHistory } from "@/app/api/history/route";

const dialect = new PgDialect();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "alice" } });
  mocks.keys.mockResolvedValue([{ id: "alice-key", provider: "kie", apiKey: "encrypted", isActive: true }]);
  mocks.key.mockResolvedValue(undefined);
  mocks.history.mockResolvedValue([]);
  mocks.count.mockResolvedValue([{ count: 0 }]);
});
describe("private user endpoints", () => {
  it("filters key reads by the authenticated user and never returns the decrypted key", async () => {
    const response = await getKeys(new NextRequest("https://app.test/api/settings/api-key?userId=bob"));
    expect(dialect.sqlToQuery(mocks.keys.mock.calls[0][0].where).params).toEqual(["alice", "kie"]);
    const body = await response.text();
    expect(body).not.toContain("alice-private-api-secret-12345678");
    expect(body).not.toContain("encrypted");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects deleting another user's key without executing a delete", async () => {
    const response = await deleteKey(new NextRequest("https://app.test/api/settings/api-key?id=bob-key", { method: "DELETE", headers: { origin: "https://app.test" } }));
    expect(response.status).toBe(404);
    expect(dialect.sqlToQuery(mocks.key.mock.calls[0][0].where).params).toEqual(["bob-key", "alice"]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("filters history by the authenticated user and caps page size", async () => {
    const response = await getHistory(new NextRequest("https://app.test/api/history?userId=bob&limit=999999&page=-1"));
    const query = mocks.history.mock.calls[0][0];
    expect(dialect.sqlToQuery(query.where).params).toEqual(["alice"]);
    expect(query).toMatchObject({ limit: 100, offset: 0 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects unauthenticated private reads", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await getKeys(new NextRequest("https://app.test/api/settings/api-key"))).status).toBe(401);
    expect((await getHistory(new NextRequest("https://app.test/api/history"))).status).toBe(401);
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
