import { after, NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, paymentOrders } from "@/lib/db";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  const order = await db.query.paymentOrders.findFirst({
    where: and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id), eq(paymentOrders.provider, "alipay")),
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "pending") return NextResponse.json({ status: order.status });
  try {
    await db.update(paymentOrders).set({ metadata: sql`${paymentOrders.metadata} || '{"cancellationRequested":true}'::jsonb`, updatedAt: new Date() }).where(and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id), eq(paymentOrders.status, "pending")));
    after(async () => { try { await reconcileAlipayOrder(id, session.user.id, true); } catch { /* The reconciliation worker retries persisted cancellation requests. */ } });
    const current = await db.query.paymentOrders.findFirst({ where: and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id)) });
    if (!current) throw new Error("CLOSE_STATUS_UNKNOWN");
    return NextResponse.json({ status: current.status, cancellationRequested: (current.metadata as Record<string, unknown>).cancellationRequested === true }, { status: current.status === "pending" ? 202 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to close order", code: "CLOSE_STATUS_UNKNOWN" }, { status: 502 });
  }
}
