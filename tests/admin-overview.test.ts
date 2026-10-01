import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import * as adminQueries from "@/lib/admin/query";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/auth", () => ({ getAdminUserFromHeaders: vi.fn(async () => ({ id: "admin" })) }));
vi.mock("@/lib/billing/credits", () => ({ getCreditBalancesForUsers: vi.fn(async () => new Map()) }));

import { GET } from "@/app/api/admin/overview/route";
import { GET as listUsers } from "@/app/api/admin/users/route";
import { getAdminUserFromHeaders } from "@/lib/auth";

const client = new PGlite();
const testDb = drizzle(client, { schema });
isolated.db = testDb;

describe("admin overview analytics", () => {
  beforeAll(async () => {
    await client.exec("CREATE TYPE user_role AS ENUM ('user','admin'); CREATE TABLE \"user\" (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false, name text, image text, role user_role NOT NULL DEFAULT 'user', is_anonymous boolean NOT NULL DEFAULT false, banned boolean, ban_reason text, ban_expires timestamp, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());");
    await client.exec("CREATE TABLE payment_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES \"user\"(id), provider text NOT NULL, provider_order_id varchar(160) NOT NULL, checkout_id varchar(160), package_id varchar(80) NOT NULL, package_name text NOT NULL, credits integer NOT NULL, amount_cents integer NOT NULL, currency varchar(10) NOT NULL, status text NOT NULL, checkout_url text, raw_payload jsonb NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}', paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());");
    await client.exec(readFileSync("drizzle/0013_admin_daily_visits.sql", "utf8"));

    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    const old = new Date(now.getTime() - 45 * 86400000);
    const [buyer, recent, older] = await testDb.insert(schema.user).values([
      { id: randomUUID(), email: "buyer@example.com", name: "Buyer", createdAt: now },
      { id: randomUUID(), email: "recent@example.com", name: "Recent", createdAt: yesterday },
      { id: randomUUID(), email: "older@example.com", name: "Older", createdAt: old },
    ]).returning();
    await testDb.insert(schema.paymentOrders).values([
      { userId: buyer.id, provider: "alipay", providerOrderId: "paid-1", packageId: "v6_trial_200", packageName: "Starter", credits: 200, amountCents: 1990, currency: "cny", status: "paid", paidAt: now },
      { userId: recent.id, provider: "alipay", providerOrderId: "pending-1", packageId: "v6_trial_200", packageName: "Starter", credits: 200, amountCents: 1990, currency: "cny", status: "pending" },
    ]);
    const today = now.toISOString().slice(0, 10);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    await testDb.insert(schema.dailyVisits).values([
      { date: today, sessionId: "session-a", userId: buyer.id, path: "/dashboard" },
      { date: today, sessionId: "session-b", path: "/" },
      { date: yesterdayKey, sessionId: "session-a", userId: buyer.id, path: "/dashboard" },
      { date: yesterdayKey, sessionId: "session-c", userId: recent.id, path: "/dashboard" },
    ]);
  });

  afterAll(async () => client.close());

  it("reports paid users and distinct visitor and signed-in activity windows", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/overview?days=14"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.overview).toMatchObject({
      totalUsers: 3,
      newUsers7d: 2,
      newUsers30d: 2,
      purchasedUsers: 1,
      visitorToday: 2,
      visitor30d: 3,
      signedInToday: 1,
      signedIn30d: 2,
    });
    expect(body.purchasedUsers).toEqual([expect.objectContaining({ email: "buyer@example.com", orderCount: 1, totalPaidCents: 1990 })]);
    expect(body.recentUsers).toHaveLength(3);
    expect(body.dataHealth.unavailable).not.toContain("daily visit metrics");
    expect(body.dataHealth.unavailable).not.toContain("activity windows");
    expect(body.dataHealth.unavailable).not.toContain("purchased users");
    expect(body.dataHealth.unavailable).not.toContain("paid orders");
  });

  it("aggregates beyond the old row caps and returns bounded user lists", async () => {
    const buyer = await testDb.query.user.findFirst({ where: (u, { eq }) => eq(u.email, "buyer@example.com") });
    await client.exec(`CREATE TABLE projects (id uuid PRIMARY KEY, user_id uuid, created_at timestamptz);
      CREATE TABLE analysis_history (user_id uuid, created_at timestamptz);
      CREATE TABLE audio_analysis (user_id uuid, created_at timestamptz);
      CREATE TABLE video_generation (user_id uuid, created_at timestamptz);
      CREATE TABLE video_clip (user_id uuid, created_at timestamptz);
      CREATE TABLE workflow_jobs (id uuid);
      CREATE TABLE operation_logs (user_id uuid, created_at timestamptz, action text, metadata jsonb);
      CREATE TABLE commercial_wallets (user_id uuid PRIMARY KEY, credits integer);
      CREATE TABLE user_credits (user_id uuid PRIMARY KEY, balance integer);`);
    await client.query(`INSERT INTO operation_logs SELECT $1, now(), 'file.upload', '{"size":100}'::jsonb FROM generate_series(1,3100)`, [buyer!.id]);
    await client.query(`INSERT INTO operation_logs VALUES ($1,now(),'file.upload','{"phase":"requested","size":999999}'::jsonb)`, [buyer!.id]);
    await client.query(`INSERT INTO analysis_history SELECT $1, now() FROM generate_series(1,1100)`, [buyer!.id]);
    await client.query(`INSERT INTO commercial_wallets VALUES ($1, 200)`, [buyer!.id]);
    await client.query(`INSERT INTO payment_orders (user_id,provider,provider_order_id,package_id,package_name,credits,amount_cents,currency,status,paid_at)
      SELECT $1,'alipay','paid-extra-'||n,'creator','Creator',200,2000,'cny','paid',now() FROM generate_series(1,1001) n`, [buyer!.id]);
    const response = await GET(new NextRequest("http://localhost/api/admin/overview?days=14"));
    const body = await response.json();
    expect(body.dataHealth).toEqual({ degraded: false, unavailable: [] });
    expect(body.overview).toMatchObject({ uploadCount: 3100, uploadBytes: 310000, analysisCount: 1100, purchasedUsers: 1 });
    expect(body.topUsers[0]).toMatchObject({ userId: buyer!.id, uploads: 3100, analyses: 1100, creditBalance: 200 });
    expect(body.purchasedUsers[0]).toMatchObject({ orderCount: 1002, totalPaidCents: 2003990 });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const listed = await listUsers(new NextRequest("http://localhost/api/admin/users?page=-1&limit=9999"));
    const result = await listed.json();
    expect(result).toMatchObject({ page: 1, limit: 100, total: 3 });
    expect(result.users.find((u: { id: string }) => u.id === buyer!.id).analysisCount).toBe(1100);
  });

  it("checks authorization before serving cached statistics or users", async () => {
    vi.mocked(getAdminUserFromHeaders).mockResolvedValueOnce(null);
    expect((await GET(new NextRequest("http://localhost/api/admin/overview?days=14"))).status).toBe(403);
    vi.mocked(getAdminUserFromHeaders).mockResolvedValueOnce(null);
    expect((await listUsers(new NextRequest("http://localhost/api/admin/users"))).status).toBe(403);
  });

  it("keeps healthy metrics available when a query times out and allows retry", async () => {
    const original = adminQueries.adminQuery;
    const spy = vi.spyOn(adminQueries, "adminQuery").mockImplementation(async <T>(query: SQL): Promise<T[]> => {
      if (new PgDialect().sqlToQuery(query).sql.includes("from daily_visits")) throw new Error("statement timeout");
      return original<T>(query);
    });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const body = await (await GET(new NextRequest("http://localhost/api/admin/overview?days=15"))).json();
      expect(body.overview.totalUsers).toBe(3);
      expect(body.purchasedUsers[0].orderCount).toBe(1002);
      expect(body.dataHealth.unavailable).toContain("activity windows");
    } finally { spy.mockRestore(); warn.mockRestore(); }
    const retry = await (await GET(new NextRequest("http://localhost/api/admin/overview?days=15"))).json();
    expect(retry.dataHealth.degraded).toBe(false);
    expect(retry.overview.visitorToday).toBe(2);
  });

  it("shares concurrent requests and uses five bounded database queries", async () => {
    const spy = vi.spyOn(adminQueries, "adminQuery");
    try {
      const responses = await Promise.all([
        GET(new NextRequest("http://localhost/api/admin/overview?days=16")),
        GET(new NextRequest("http://localhost/api/admin/overview?days=16")),
      ]);
      expect(responses.map(response => response.status)).toEqual([200, 200]);
      expect(spy).toHaveBeenCalledTimes(5);
      await GET(new NextRequest("http://localhost/api/admin/overview?days=16"));
      expect(spy).toHaveBeenCalledTimes(5);
    } finally { spy.mockRestore(); }
  });
});
