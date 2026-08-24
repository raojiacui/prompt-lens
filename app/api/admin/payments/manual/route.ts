import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { settlePaidCreditOrder } from "@/lib/payments/credit-checkout";
import { db, operationLogs, paymentOrders, user } from "@/lib/db";

export async function GET(request: NextRequest) {
  const adminUser = await getAdminUserFromHeaders(request.headers);
  if (!adminUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const status = request.nextUrl.searchParams.get("status") === "paid" ? "paid" : "pending";
  const rows = await db
    .select({
      order: paymentOrders,
      userEmail: user.email,
      userName: user.name,
    })
    .from(paymentOrders)
    .innerJoin(user, eq(paymentOrders.userId, user.id))
    .where(and(eq(paymentOrders.provider, "manual_qr"), eq(paymentOrders.status, status)))
    .orderBy(desc(paymentOrders.createdAt))
    .limit(50);

  return NextResponse.json({
    orders: rows.map((row) => ({
      ...row.order,
      user: { email: row.userEmail, name: row.userName },
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await getAdminUserFromHeaders(request.headers);
    if (!adminUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

    const result = await settlePaidCreditOrder({
      provider: "manual_qr",
      lookupOrderId: orderId,
      metadata: {
        confirmedBy: adminUser.id,
        confirmedByEmail: adminUser.email,
        source: "admin_manual_payment_confirm",
      },
    });

    await db.insert(operationLogs).values({
      userId: adminUser.id,
      action: "admin.credit_grant",
      resourceType: "payment_order",
      resourceId: result.order.id,
      metadata: {
        orderId: result.order.id,
        providerOrderId: result.order.providerOrderId,
        targetUserId: result.order.userId,
        amount: result.order.credits,
        packageId: result.order.packageId,
        paymentProvider: "manual_qr",
        granted: result.granted,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Confirm manual payment error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "确认付款失败" }, { status: 500 });
  }
}
