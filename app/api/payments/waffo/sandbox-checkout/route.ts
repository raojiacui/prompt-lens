import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";
import { createWaffoSandboxCheckout } from "@/lib/payments/waffo-client";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  // Explicitly sandbox-only. No production checkout or credits are enabled by this route.
  if (process.env.WAFFO_SANDBOX_CHECKOUT_ENABLED !== "true" || process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ code: "WAFFO_SANDBOX_DISABLED" }, { status: 503 });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id || !session.user.email) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload.packageId !== "string" || typeof payload.requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.requestId)) {
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }
  const pack = COMMERCIAL_PACKAGES.find(p => p.id === payload.packageId);
  if (!pack) return NextResponse.json({ code: "UNKNOWN_PACKAGE" }, { status: 400 });
  const productEnv = "WAFFO_TEST_PRODUCT_" + pack.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const productId = process.env[productEnv];
  if (!productId) return NextResponse.json({ code: "WAFFO_PRODUCT_NOT_CONFIGURED" }, { status: 503 });
  const externalOrderId = "test_" + createHash("sha256").update(session.user.id + ":" + payload.requestId).digest("hex").slice(0, 40);
  try {
    const response = await createWaffoSandboxCheckout({
      productId, amountCents: pack.priceCents, currency: "CNY",
      buyerIdentity: session.user.id, buyerEmail: session.user.email, externalOrderId,
    });
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return NextResponse.json({ code: "WAFFO_CHECKOUT_UNAVAILABLE" }, { status: 503 });
  }
}
