import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/reference-video/auth", () => ({ requireReferenceVideoUser: mocks.auth }));
vi.mock("@/lib/db", async () => ({ ...(await import("@/lib/db/schema")), db: { execute: mocks.execute, transaction: mocks.transaction } }));
import { GET } from "@/app/api/generation-history/route";
import { expireGenerationHistory } from "@/lib/workflow/generation-retention";

describe("generation history", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development"); mocks.auth.mockResolvedValue({ user: { id: "owner" }, response: null }); mocks.execute.mockResolvedValue([]); });
  afterEach(() => vi.unstubAllEnvs());
  it("requires authentication before reading records", async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({}, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/generation-history"))).status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("merges both funding paths, scopes both to the owner, and excludes duplicate provider copies", async () => {
    const rows = [{ id: "commercial:1", payer: "platform", status: "completed" }, { id: "2", payer: "byok", status: "failed" }];
    mocks.execute.mockResolvedValue(rows);
    const response = await GET(new Request("http://localhost/api/generation-history"));
    expect(await response.json()).toMatchObject({ history: rows, retentionDays: null });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params.filter(p => p === "owner")).toHaveLength(2);
    expect(query.sql).toContain("union all");
    expect(query.sql).toContain("commercialTaskId");
    expect(query.sql).not.toContain("keyFingerprint");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("paginates without dropping the extra next-page record", async () => {
    mocks.execute.mockResolvedValue(Array.from({ length: 21 }, (_, id) => ({ id })));
    const body = await (await GET(new Request("http://localhost/api/generation-history?page=2"))).json();
    expect(body.history).toHaveLength(20); expect(body.hasMore).toBe(true);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params.slice(-2)).toEqual([21, 20]);
  });
  it("applies seven-day retention only in production, keeping active jobs visible", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await (await GET(new Request("http://localhost/api/generation-history"))).json()).toMatchObject({ retentionDays: 7 });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params.filter(p => p === false)).toHaveLength(2);
    expect(query.sql).toContain("interval '7 days'");
    expect(query.sql).toContain("'queued','running','review'");
  });
  it("never clears local testing history", async () => {
    expect(await expireGenerationHistory()).toEqual({ expiredGenerations: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("removes expired terminal generation content while preserving financial rows", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const conditions: unknown[] = [];
    const update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn(condition => { conditions.push(condition); return Promise.resolve(); }) }) });
    const remove = vi.fn().mockReturnValue({ where: vi.fn(condition => { conditions.push(condition); return { returning: vi.fn().mockResolvedValue([{ id: "old" }]) }; }) });
    mocks.transaction.mockImplementation(callback => callback({ delete: remove, update }));
    expect(await expireGenerationHistory()).toEqual({ expiredGenerations: 1 });
    expect(remove).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledOnce();
    const queries = conditions.map(condition => new PgDialect().sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]));
    expect(queries[0].sql).toContain("not exists");
    expect(queries[1].params).toContain("generation");
    expect(queries[1].params).not.toContain("running");
  });
});
