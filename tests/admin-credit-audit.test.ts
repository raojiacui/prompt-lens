import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, admin: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ getAdminUserFromHeaders: mocks.admin }));
import { GET as listUsers } from "@/app/api/admin/users/route";
import { GET as records } from "@/app/api/admin/users/[id]/credits/route";

const client = new PGlite();
const db = drizzle(client, { schema });
mocks.db = db;
const ids = { owner: randomUUID(), paid: randomUUID(), manual: randomUUID(), tampered: randomUUID(), pending: randomUUID(), held: randomUUID(), zero: randomUUID() };
describe("admin credit audit", () => {
  beforeAll(async () => {
    await client.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) for (const statement of readFileSync(`drizzle/${entry.tag}.sql`,"utf8").split("--> statement-breakpoint")) await client.exec(statement);
    await db.insert(schema.user).values(Object.entries(ids).map(([name,id])=>({ id, email: name==="owner" ? "raojiacui@gmail.com" : `${name}@example.com`, emailVerified: true })));
    mocks.admin.mockResolvedValue({ id: ids.owner });
    await db.insert(schema.userCredits).values([
      { userId: ids.paid, balance: 150 }, { userId: ids.manual, balance: 20 },
      { userId: ids.tampered, balance: 100 }, { userId: ids.pending, balance: 30 }, { userId: ids.zero, balance: 0 },
    ]);
    const [paidOrder, pendingOrder, heldOrder] = await db.insert(schema.paymentOrders).values([
      { userId: ids.paid, provider: "alipay", providerOrderId: "real-paid", packageId: "legacy", packageName: "Paid plan", credits: 200, amountCents: 2990, currency: "cny", status: "paid", paidAt: new Date() },
      { userId: ids.pending, provider: "alipay", providerOrderId: "not-paid", packageId: "legacy", packageName: "Pending plan", credits: 30, amountCents: 990, currency: "cny", status: "pending" },
      { userId: ids.held, provider: "alipay", providerOrderId: "v2-paid", packageId: "v6", packageName: "V2 plan", credits: 200, amountCents: 2990, currency: "cny", status: "paid", paidAt: new Date() },
    ]).returning();
    await db.insert(schema.creditLedger).values([
      { userId: ids.paid, amount: 200, balanceAfter: 200, type: "payment_grant", packageId: "legacy", paymentProvider: "alipay", paymentReference: paidOrder.providerOrderId },
      { userId: ids.paid, amount: -50, balanceAfter: 150, type: "feature_usage" },
      { userId: ids.manual, amount: 20, balanceAfter: 20, type: "manual_grant", actorUserId: ids.owner },
      { userId: ids.pending, amount: 30, balanceAfter: 30, type: "payment_grant", packageId: "legacy", paymentProvider: "alipay", paymentReference: pendingOrder.providerOrderId },
    ]);
    await db.insert(schema.commercialWallets).values({ userId: ids.held, credits: 150, heldCredits: 50 });
    await db.insert(schema.commercialLedger).values({ userId: ids.held, eventKey: `purchase:${heldOrder.id}`, credits: 200, rewrites: 0, metadata: { orderId: heldOrder.id } });
  },30_000);
  afterAll(async () => client.close());

  async function users(q="",page=1,limit=20) {
    const response = await listUsers(new NextRequest(`http://localhost/api/admin/users?view=credits&q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`));
    expect(response.status).toBe(200);
    return response.json();
  }
  it("includes every positive balance, including accounts without paid orders", async () => {
    const body = await users();
    expect(body.total).toBe(5);
    expect(body.users.map((u: { id: string })=>u.id).sort()).toEqual([ids.paid,ids.manual,ids.tampered,ids.pending,ids.held].sort());
    expect(body.users.find((u: {id:string})=>u.id===ids.tampered)).toMatchObject({ orderCount: 0, auditStatus: "balance_mismatch", legacyBalance: 100 });
    expect(body.users.find((u: {id:string})=>u.id===ids.manual)).toMatchObject({ orderCount: 0, auditStatus: "manual_grant", manualCredits: 20, unverifiedCredits: 0 });
    expect(body.users.find((u: {id:string})=>u.id===ids.pending)).toMatchObject({ orderCount: 0, totalPaidCents: 0, auditStatus: "unverified_source", unverifiedCredits: 30 });
    expect(body.users.find((u: {id:string})=>u.id===ids.paid)).toMatchObject({ orderCount: 1, totalPaidCents: 2990, auditStatus: "ledger_consistent", legacyBalance: 150, ledgerBalance: 150 });
    expect(body.users.find((u: {id:string})=>u.id===ids.held)).toMatchObject({ auditStatus: "ledger_consistent", commercialBalance: 150, heldCredits: 50, ledgerBalance: 200 });
  });
  it("searches and paginates without dropping accounts", async () => {
    const first=await users("",1,2),second=await users("",2,2),third=await users("",3,2);
    expect(new Set([...first.users,...second.users,...third.users].map(u=>u.id)).size).toBe(5);
    expect((await users("manual@example.com")).users).toHaveLength(1);
    expect((await users("%_'")).total).toBe(0);
  });
  it("loads only the selected account's paginated orders and ledger", async () => {
    const context = { params: Promise.resolve({ id: ids.paid }) };
    const orderResponse=await records(new NextRequest("http://localhost/api/admin/users/id/credits?kind=orders&limit=1"),context);
    expect(orderResponse.headers.get("Cache-Control")).toBe("private, no-store");
    const orders=await orderResponse.json();
    expect(orders.total).toBe(1);
    expect(orders.entries[0]).toMatchObject({ reference: "real-paid", status: "paid", credits: 200 });
    expect(orders.entries[0]).not.toHaveProperty("rawPayload");
    const first=await (await records(new NextRequest("http://localhost/api/admin/users/id/credits?kind=ledger&limit=1&page=1"),context)).json();
    const second=await (await records(new NextRequest("http://localhost/api/admin/users/id/credits?kind=ledger&limit=1&page=2"),context)).json();
    expect(first.total).toBe(2);
    expect(first.entries[0].id).not.toBe(second.entries[0].id);
    expect(first.entries[0].kind).toBe("legacy");
  });
  it("flags positive credits with missing source metadata", async () => {
    const entryId = randomUUID();
    await client.query("INSERT INTO commercial_ledger (id,user_id,event_key,credits,rewrites,metadata) VALUES ($1,$2,'purchase:missing-source',10,0,'{}')", [entryId,ids.held]);
    await client.query("UPDATE commercial_wallets SET credits=160 WHERE user_id=$1", [ids.held]);
    try {
      const body = await users("held@example.com");
      expect(body.users[0]).toMatchObject({ auditStatus: "unverified_source", unverifiedCredits: 10 });
    } finally {
      await client.query("DELETE FROM commercial_ledger WHERE id=$1", [entryId]);
      await client.query("UPDATE commercial_wallets SET credits=150 WHERE user_id=$1", [ids.held]);
    }
  });
  it("rejects ordinary users before querying financial records", async () => {
    mocks.admin.mockResolvedValueOnce(null);
    expect((await listUsers(new NextRequest("http://localhost/api/admin/users?view=credits"))).status).toBe(403);
    mocks.admin.mockResolvedValueOnce(null);
    expect((await records(new NextRequest("http://localhost/api/admin/users/id/credits"),{params:Promise.resolve({id:ids.paid})})).status).toBe(403);
  });
});
