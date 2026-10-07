import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ session: vi.fn(), where: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/workflow/service", () => ({ createProject: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { ...schema, db: { select: () => ({ from: () => ({ where: mocks.where }) }) } };
});
import { GET } from "@/app/api/workflow/projects/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "alice" } });
  mocks.where.mockReturnValue({ orderBy: () => ({ limit: mocks.limit }) });
  mocks.limit.mockResolvedValue([{ id: "alice-project" }]);
});
describe("project list route", () => {
  it("only lists the logged-in user's projects and caps the requested limit", async () => {
    const response = await GET(new NextRequest("https://app.test/api/workflow/projects?limit=999"));
    expect(response.status).toBe(200);
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual(["alice"]);
    expect(mocks.limit).toHaveBeenCalledWith(50);
  });
  it("rejects unauthenticated reads without querying projects", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://app.test/api/workflow/projects"))).status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it.each(["session", "limit"] as const)("returns safe uncached JSON when %s fails", async (stage) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks[stage].mockRejectedValue(new Error("private database connection details"));
    try {
      const response = await GET(new NextRequest("https://app.test/api/workflow/projects"));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ code: "PROJECTS_UNAVAILABLE" });
    } finally { log.mockRestore(); }
  });
});
