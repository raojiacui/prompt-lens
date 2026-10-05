import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createAlipayCreditCheckout } from "@/lib/payments/credit-checkout";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";

export async function GET() {
  return NextResponse.json({ enabled: true, provider: "alipay", method: "alipay" }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.provider !== "alipay" || body?.method !== "alipay") return NextResponse.json({ error: "Only Alipay is supported", code: "UNSUPPORTED_PAYMENT_METHOD" }, { status: 400 });
  if (!COMMERCIAL_PACKAGES.some((pack) => pack.id === body?.packageId)) return NextResponse.json({ error: "Package unavailable" }, { status: 400 });
  if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) return NextResponse.json({ error: "Invalid checkout request ID" }, { status: 400 });
  try {
    return NextResponse.json(await createAlipayCreditCheckout(session.user.id, body.packageId, body.requestId));
  } catch {
    return NextResponse.json({ error: "Unable to confirm checkout. Retry the same request.", code: "CHECKOUT_STATUS_UNKNOWN" }, { status: 502 });
  }
}
