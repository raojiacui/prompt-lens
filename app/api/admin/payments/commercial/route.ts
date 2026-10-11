import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { db, user, paymentOrders, commercialRefunds, commercialReservations, commercialWallets, commercialTasks } from "@/lib/db";
import { commercialReadiness } from "@/lib/billing/commercial-readiness";
import { canFullyReleaseTask, releaseUnfulfilledCommercialAnalysis } from "@/lib/billing/commercial-review";
import { reconcileAlipayOrder } from "@/lib/payments/alipay-reconciliation";
import { reconcileCommercialRefund, reviewCommercialRefund } from "@/lib/payments/commercial-refunds";

export async function GET(request: NextRequest) {
  if (!await getAdminUserFromHeaders(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const refundView = request.nextUrl.searchParams.get("view") === "refunds";
  const page = Math.max(1, Math.min(100000, Math.floor(Number(request.nextUrl.searchParams.get("page")) || 1)));
  const [counts] = await db.select({ total: sql<number>`count(*)::int` }).from(commercialRefunds).where(inArray(commercialRefunds.state, ["requested", "processing", "review"]));
  if (request.nextUrl.searchParams.get("countOnly") === "1") return NextResponse.json({ total: counts.total }, { headers: { "Cache-Control": "private, no-store" } });
  const reviewFilter = and(eq(commercialTasks.state, "review"), inArray(commercialTasks.kind, ["analysis", "generation"]));
  const [reviewCount] = await db.select({ total: sql<number>`count(*)::int` }).from(commercialTasks).where(reviewFilter);
  const reviewRows = await db.select({ id: commercialTasks.id, userId: commercialTasks.userId, kind: commercialTasks.kind, result: commercialTasks.result, updatedAt: commercialTasks.updatedAt, providerTaskId: commercialTasks.providerTaskId, reservationId: commercialReservations.id, reservationCreatedAt: commercialReservations.createdAt, reservedCredits: commercialReservations.credits })
    .from(commercialTasks)
    .leftJoin(commercialReservations, and(eq(commercialReservations.taskKey, sql`'commercial:' || ${commercialTasks.id}::text`), eq(commercialReservations.state, "held")))
    .where(reviewFilter)
    .orderBy(asc(commercialTasks.updatedAt)).limit(50);
  const taskReviews = reviewRows.map(row => {
    const result = row.result as { review?: { reason?: string; action?: string; deadlineAt?: string; nextActionAt?: string; escalatedAt?: string }; successfulSceneIds?: unknown; finishedSceneIds?: unknown; diagnostic?: { error?: { message?: string } } };
    const review = result.review;
    return { id: row.id, userId: row.userId, kind: row.kind, reason: review?.reason || "legacy_review", action: review?.action || "manual_reconciliation", deadlineAt: review?.deadlineAt || null, nextActionAt: review?.nextActionAt || null, escalatedAt: review?.escalatedAt || null, reservedCredits: row.reservedCredits ?? 0, reservationId: row.reservationId, canFullyRelease: Boolean(row.reservationId && row.reservationCreatedAt && Date.now() - row.reservationCreatedAt.getTime() >= 86400000 && canFullyReleaseTask({ state: "review", kind: row.kind, result: row.result })), updatedAt: row.updatedAt, providerTaskId: row.providerTaskId, successfulScenes: Array.isArray(result.successfulSceneIds) ? result.successfulSceneIds.length : 0, finishedScenes: Array.isArray(result.finishedSceneIds) ? result.finishedSceneIds.length : 0, diagnostic: result.diagnostic?.error?.message?.slice(0, 300) || null };
  });
  const refunds = await db.select({ id: commercialRefunds.id, orderId: commercialRefunds.orderId, userId: commercialRefunds.userId, email: user.email, name: user.name, packageName: paymentOrders.packageName, state: commercialRefunds.state, reason: commercialRefunds.reason, contact: sql<string>`${commercialRefunds.evidence}->>'contact'`, amountCents: paymentOrders.amountCents, createdAt: commercialRefunds.createdAt }).from(commercialRefunds).innerJoin(paymentOrders, eq(paymentOrders.id, commercialRefunds.orderId)).leftJoin(user, eq(user.id, commercialRefunds.userId)).where(inArray(commercialRefunds.state, ["requested", "processing", "review"])).orderBy(asc(commercialRefunds.createdAt), asc(commercialRefunds.id)).limit(refundView ? 20 : 100).offset(refundView ? (page - 1) * 20 : 0);
  if (refundView) return NextResponse.json({ refunds, taskReviews, taskReviewTotal: reviewCount.total, total: counts.total, page }, { headers: { "Cache-Control": "private, no-store" } });
  const orders = await db.select({ id: paymentOrders.id, userId: paymentOrders.userId, amountCents: paymentOrders.amountCents, status: paymentOrders.status, createdAt: paymentOrders.createdAt, reconciliation: sql<string>`${paymentOrders.metadata}->>'reconciliation'` }).from(paymentOrders).where(and(eq(paymentOrders.provider, "alipay"), eq(paymentOrders.status, "pending"))).orderBy(asc(paymentOrders.createdAt)).limit(100);
  const tasks = await db.select({ id: commercialReservations.id, userId: commercialReservations.userId, taskKey: commercialReservations.taskKey, credits: commercialReservations.credits, rewrites: commercialReservations.rewrites, createdAt: commercialReservations.createdAt }).from(commercialReservations).where(and(eq(commercialReservations.state, "held"), sql`${commercialReservations.createdAt} < now() - interval '24 hours'`)).orderBy(asc(commercialReservations.createdAt)).limit(100);
  const frozen = await db.select({ userId: commercialWallets.userId }).from(commercialWallets).where(eq(commercialWallets.frozen, true)).limit(100);
  return NextResponse.json({ orders, refunds, tasks, taskReviews, taskReviewTotal: reviewCount.total, frozen, readiness: commercialReadiness() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminUserFromHeaders(request.headers);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.action === "query_refund") {
    if (typeof body.refundId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.refundId)) return NextResponse.json({ error: "Invalid refund" }, { status: 400 });
    try {
      const refund = await reconcileCommercialRefund(admin.id, body.refundId);
      return NextResponse.json({ id: refund.id, state: refund.state });
    } catch { return NextResponse.json({ error: "Refund requires manual review; no refund was resubmitted" }, { status: 409 }); }
  }
  if (body?.action === "approve_refund" || body?.action === "reject_refund") {
    if (body.action === "approve_refund" && body.approveConfirmed !== true) return NextResponse.json({ error: "Explicit refund approval is required" }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(body.refundId || "") || typeof body.evidence !== "string" || !body.evidence.trim() || body.evidence.length > 2000 || body.customerContacted !== true) return NextResponse.json({ error: "Customer contact and review evidence are required" }, { status: 400 });
    try {
      const refund = await reviewCommercialRefund(admin.id, body.refundId, body.action === "approve_refund" ? "approve" : "reject", body.evidence);
      return NextResponse.json({ id: refund.id, state: refund.state });
    } catch { return NextResponse.json({ error: "Refund changed or requires review; do not repeat the payment request" }, { status: 409 }); }
  }
  if (body?.action === "release_unfulfilled_task") {
    if (!/^[0-9a-f-]{36}$/i.test(body.reservationId || "") || typeof body.evidence !== "string" || body.evidence.trim().length < 12 || body.evidence.length > 2000 || body.deliveryConfirmed !== true) return NextResponse.json({ error: "Delivery review and evidence are required" }, { status: 400 });
    try {
      await releaseUnfulfilledCommercialAnalysis({ reservationId: body.reservationId, actorId: admin.id, evidence: body.evidence.trim() });
      return NextResponse.json({ success: true });
    } catch { return NextResponse.json({ error: "Reservation changed; refresh before reviewing" }, { status: 409 }); }
  }
  if (body?.action !== "query" || !/^[0-9a-f-]{36}$/i.test(body?.orderId || "")) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const order = await db.query.paymentOrders.findFirst({ where: eq(paymentOrders.id, body.orderId) });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.provider !== "alipay") return NextResponse.json({ error: "Unsupported payment provider" }, { status: 409 });
  await reconcileAlipayOrder(order.id);
  return NextResponse.json({ success: true });
}
