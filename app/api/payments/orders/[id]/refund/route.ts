import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestCommercialRefund } from "@/lib/payments/commercial-refunds";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Refunds require a deliberate same-origin action, never a cross-site form submission.
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof body?.reason !== "string") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const refund = await requestCommercialRefund(session.user.id, id, body.reason);
    return NextResponse.json({ id: refund.id, state: refund.state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "REFUND_REQUIRES_REVIEW";
    const safeCode = ["ORDER_NOT_FOUND", "ORDER_NOT_PAID", "INVALID_REFUND_REASON", "PACKAGE_USED_OR_RESERVED"].includes(code) ? code : "REFUND_REQUIRES_REVIEW";
    return NextResponse.json({ code: safeCode }, { status: safeCode === "ORDER_NOT_FOUND" ? 404 : 409 });
  }
}
