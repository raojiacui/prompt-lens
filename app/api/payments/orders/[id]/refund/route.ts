import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestCommercialRefund, updateCommercialRefundRequest } from "@/lib/payments/commercial-refunds";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Refunds require a deliberate same-origin action, never a cross-site form submission.
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof body?.reason !== "string" || typeof body?.contact !== "string" || body.contact.length > 100 || body.contact.trim().length < 3) return NextResponse.json({ error: "请填写退款原因和联系方式。" }, { status: 400 });
  try {
    const refund = await requestCommercialRefund(session.user.id, id, body.reason, body.contact.trim());
    return NextResponse.json({ id: refund.id, state: refund.state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "REFUND_REQUIRES_REVIEW";
    const safeCode = ["ORDER_NOT_FOUND", "ORDER_NOT_PAID", "INVALID_REFUND_REASON", "PACKAGE_USED_OR_RESERVED"].includes(code) ? code : "REFUND_REQUIRES_REVIEW";
    return NextResponse.json({ code: safeCode }, { status: safeCode === "ORDER_NOT_FOUND" ? 404 : 409 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof body?.reason !== "string" || !body.reason.trim() || body.reason.length > 80 || typeof body?.contact !== "string" || body.contact.length > 100 || body.contact.trim().length < 3) return NextResponse.json({ error: "Invalid refund details" }, { status: 400 });
  try {
    const refund = await updateCommercialRefundRequest(session.user.id, id, body.reason, body.contact);
    return NextResponse.json({ id: refund.id, state: refund.state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "REFUND_REQUIRES_REVIEW";
    const safeCode = ["ORDER_NOT_FOUND", "REFUND_NOT_FOUND", "REFUND_ALREADY_REVIEWED"].includes(code) ? code : "REFUND_REQUIRES_REVIEW";
    return NextResponse.json({ code: safeCode }, { status: ["ORDER_NOT_FOUND", "REFUND_NOT_FOUND"].includes(safeCode) ? 404 : 409 });
  }
}
