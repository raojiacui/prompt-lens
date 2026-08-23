import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createCreemCreditCheckout, createXunhuPayCreditCheckout, type XunhuPayMethod } from "@/lib/payments/credit-checkout";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const packageId = typeof body?.packageId === "string" ? body.packageId.trim() : "";
  const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
  const method = body?.method === "wechat" || body?.method === "alipay" ? body.method as XunhuPayMethod : undefined;
  if (!packageId) return NextResponse.json({ error: "Missing packageId" }, { status: 400 });

  try {
    if (provider === "creem") {
      const checkout = await createCreemCreditCheckout(session.user.id, packageId);
      return NextResponse.json(checkout);
    }
    if (provider === "xunhupay") {
      if (!method) return NextResponse.json({ error: "Missing xunhupay method" }, { status: 400 });
      const checkout = await createXunhuPayCreditCheckout(session.user.id, packageId, method);
      return NextResponse.json(checkout);
    }
    return NextResponse.json({ error: "Unsupported payment provider" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Checkout failed" }, { status: 500 });
  }
}