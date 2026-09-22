import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, paymentOrders } from "@/lib/db";
import { closeAlipayTrade } from "@/lib/payments/alipay";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  const order = await db.query.paymentOrders.findFirst({
    where: and(eq(paymentOrders.id, id), eq(paymentOrders.userId, session.user.id), eq(paymentOrders.provider, "alipay")),
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "pending") return NextResponse.json({ status: order.status });
  try {
    const result = await closeAlipayTrade(order.providerOrderId) as Record<string, unknown>;
    if (String(result.code) !== "10000") throw new Error("Alipay close rejected");
    await db.update(paymentOrders).set({ status: "cancelled", rawPayload: result, updatedAt: new Date() }).where(and(eq(paymentOrders.id, id), eq(paymentOrders.status, "pending")));
    return NextResponse.json({ status: "cancelled" });
  } catch {
    return NextResponse.json({ error: "Unable to close order", code: "CLOSE_STATUS_UNKNOWN" }, { status: 502 });
  }
}
