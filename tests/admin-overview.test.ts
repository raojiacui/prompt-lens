import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/auth", () => ({ getAdminUserFromHeaders: vi.fn(async () => ({ id: "admin" })) }));
vi.mock("@/lib/billing/credits", () => ({ getCreditBalancesForUsers: vi.fn(async () => new Map()) }));

import { GET } from "@/app/api/admin/overview/route";

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
      { userId: buyer.id, provider: "xunhupay", providerOrderId: "paid-1", packageId: "v6_trial_200", packageName: "Starter", credits: 200, amountCents: 1990, currency: "cny", status: "paid", paidAt: now },
      { userId: recent.id, provider: "xunhupay", providerOrderId: "pending-1", packageId: "v6_trial_200", packageName: "Starter", credits: 200, amountCents: 1990, currency: "cny", status: "pending" },
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
});
