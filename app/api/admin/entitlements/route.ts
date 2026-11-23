import { NextRequest, NextResponse } from "next/server";
import { getAdminUserFromHeaders } from "@/lib/auth";
import { giftInput, issueEntitlementGift, listEntitlementGifts } from "@/lib/admin/entitlement-grants";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  if (!await getAdminUserFromHeaders(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  try {
    return NextResponse.json({ packages: COMMERCIAL_PACKAGES, records: await listEntitlementGifts() }, { headers });
  } catch (error) {
    console.error("Gift records unavailable", error);
    return NextResponse.json({ error: "发放记录暂时不可用，请稍后重试" }, { status: 503, headers });
  }
}
export async function POST(request: NextRequest) {
  const admin = await getAdminUserFromHeaders(request.headers);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  const parsed = giftInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "请检查发放参数" }, { status: 400, headers });
  try {
    return NextResponse.json(await issueEntitlementGift(parsed.data, admin.id), { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const errors: Record<string, [number, string]> = {
      GIFT_USER_NOT_FOUND: [404, "未找到该邮箱的已注册用户，请让对方先注册"],
      GIFT_USER_UNAVAILABLE: [409, "该账户暂时无法接收权益"],
      GIFT_REPLAY_MISMATCH: [409, "该发放请求已使用，请刷新记录后重新发放"],
    };
    const [status, message] = errors[code] || [503, "暂时无法确认发放结果，请使用同一请求重试或查看发放记录"];
    if (!errors[code]) console.error("Gift grant failed", error);
    return NextResponse.json({ error: message }, { status, headers });
  }
}
