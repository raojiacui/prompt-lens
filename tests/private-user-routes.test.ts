import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ session: vi.fn(), keys: vi.fn(), key: vi.fn(), execute: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/utils/encryption", () => ({ isValidEncryptedKey: () => true, decryptApiKey: () => "alice-private-api-secret-12345678", encryptApiKey: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { ...schema, db: { query: { userApiKeys: { findMany: mocks.keys, findFirst: mocks.key } }, execute: mocks.execute, delete: () => ({ where: mocks.remove }) } };
});
import { GET as getKeys, DELETE as deleteKey } from "@/app/api/settings/api-key/route";
import { GET as getHistory } from "@/app/api/history/route";

const dialect = new PgDialect();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "alice" } });
  mocks.keys.mockResolvedValue([{ id: "alice-key", provider: "kie", apiKey: "encrypted", isActive: true }]);
  mocks.key.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue([]);
});
describe("private user endpoints", () => {
  it("filters key reads by the authenticated user and never returns the decrypted key", async () => {
    const response = await getKeys(new NextRequest("https://app.test/api/settings/api-key?userId=bob"));
    expect(dialect.sqlToQuery(mocks.keys.mock.calls[0][0].where).params).toEqual(["alice", "infistar", "kie"]);
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
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    for (const [statement] of mocks.execute.mock.calls) {
      const query = dialect.sqlToQuery(statement);
      expect(query.sql).toContain("h.user_id =");
      expect(query.sql).toContain("p.user_id =");
      expect(query.params.filter(value => value === "alice")).toHaveLength(2);
      expect(query.params).not.toContain("bob");
    }
    expect(dialect.sqlToQuery(mocks.execute.mock.calls[0][0]).params.slice(-2)).toEqual([100, 0]);
    expect(await response.json()).toMatchObject({ page: 1, limit: 100, history: [], total: 0 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects unauthenticated private reads", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await getKeys(new NextRequest("https://app.test/api/settings/api-key"))).status).toBe(401);
    expect((await getHistory(new NextRequest("https://app.test/api/history"))).status).toBe(401);
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
