import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createWaffoOrder } from "@/lib/payments/waffo-orders";
import { waffoAvailablePackages } from "@/lib/payments/waffo-client";

export const runtime = "nodejs";
export async function GET() {
  const packages = waffoAvailablePackages();
  return NextResponse.json({ provider: "waffo", enabled: packages.length > 0, packages }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.packageId !== "string" || typeof body?.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) return NextResponse.json({ code: "INVALID_CHECKOUT_REQUEST" }, { status: 400 });
  if (!waffoAvailablePackages().includes(body.packageId)) return NextResponse.json({ code: "PACKAGE_NOT_OPEN" }, { status: 409 });
  try {
    return NextResponse.json(await createWaffoOrder(session.user.id, session.user.email, body.packageId, body.requestId), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ code: "CHECKOUT_STATUS_UNKNOWN", error: "无法确认结账状态，请保留本次请求重试或联系支持。" }, { status: 502 });
  }
}
