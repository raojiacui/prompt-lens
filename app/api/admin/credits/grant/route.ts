import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, operationLogs, user } from "@/lib/db";
import { CREDIT_PACKAGES, getCreditPackage } from "@/lib/billing/credit-packages";
import { findUserForCreditGrant, grantCreditsToUser, normalizeCreditAmount } from "@/lib/billing/credits";

async function requireAdmin(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const currentUser = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  return currentUser?.role === "admin" ? currentUser : null;
}

export async function GET(request: NextRequest) {
  const adminUser = await requireAdmin(request.headers);
  if (!adminUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return NextResponse.json({ packages: CREDIT_PACKAGES });
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request.headers);
    if (!adminUser) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const packageConfig = getCreditPackage(body.packageId);
    const amount = normalizeCreditAmount(body.amount ?? packageConfig?.credits);
    const targetUser = await findUserForCreditGrant({ userId: body.userId, email: body.email });

    if (!targetUser) {
      return NextResponse.json({ error: "找不到这个用户，请确认邮箱已经注册" }, { status: 404 });
    }
    if (!amount) {
      return NextResponse.json({ error: "积分数量必须是大于 0 的整数" }, { status: 400 });
    }

    const paymentProvider = typeof body.paymentProvider === "string" ? body.paymentProvider.trim() : "manual_qr";
    const paymentReference = typeof body.paymentReference === "string" ? body.paymentReference.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const balance = await grantCreditsToUser({
      targetUserId: targetUser.id,
      actorUserId: adminUser.id,
      amount,
      type: "manual_grant",
      packageId: packageConfig?.id || body.packageId || null,
      paymentProvider: paymentProvider || "manual_qr",
      paymentReference: paymentReference || null,
      note: note || "后台手动发放积分",
      metadata: {
        targetEmail: targetUser.email,
        adminEmail: adminUser.email,
        source: "admin_panel",
      },
    });

    await db.insert(operationLogs).values({
      userId: adminUser.id,
      action: "admin.credit_grant",
      resourceType: "user",
      resourceId: targetUser.id,
      metadata: {
        targetEmail: targetUser.email,
        amount,
        balanceAfter: balance.balance,
        packageId: packageConfig?.id || body.packageId || null,
        paymentProvider: paymentProvider || "manual_qr",
        paymentReference: paymentReference || null,
      },
    });

    return NextResponse.json({
      success: true,
      user: { id: targetUser.id, email: targetUser.email, name: targetUser.name },
      credits: balance,
    });
  } catch (error) {
    console.error("Admin credit grant error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}