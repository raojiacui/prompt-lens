import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createManualCreditPayment, type ManualPaymentMethod } from "@/lib/payments/credit-checkout";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const packageId = typeof body?.packageId === "string" ? body.packageId.trim() : "";
  const method = body?.method === "wechat" || body?.method === "alipay" ? body.method as ManualPaymentMethod : null;
  const paymentReference = typeof body?.paymentReference === "string" ? body.paymentReference.trim() : "";
  const contact = typeof body?.contact === "string" ? body.contact.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!packageId) return NextResponse.json({ error: "Missing packageId" }, { status: 400 });
  if (!method) return NextResponse.json({ error: "Missing payment method" }, { status: 400 });
  if (!paymentReference && !contact) {
    return NextResponse.json({ error: "请填写付款备注、流水号或联系方式，方便平台核对到账" }, { status: 400 });
  }

  try {
    const order = await createManualCreditPayment(session.user.id, packageId, method, { paymentReference, contact, note });
    return NextResponse.json({ success: true, order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交付款信息失败" }, { status: 500 });
  }
}