import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isUserProvider } from "@/lib/ai/providers";
import { getUserCredential } from "@/lib/byok/credentials";
import { listInfistarModels } from "@/lib/ai/infistar-client";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!isUserProvider(body?.provider)) return NextResponse.json({ error: "Unsupported API provider" }, { status: 400 });
  const { allowed } = await checkRateLimit(`provider-test:${session.user.id}`, 6, 60_000);
  if (!allowed) return NextResponse.json({ error: "Too many connection tests. Try again shortly." }, { status: 429 });
  try {
    const key = typeof body.apiKey === "string" ? body.apiKey.trim() : (await getUserCredential(session.user.id, body.provider))?.apiKey;
    if (!key || key.length < 16 || key.length > 512) return NextResponse.json({ error: "Invalid API Key" }, { status: 400 });
    if (body.provider === "infistar") await listInfistarModels(key);
    else {
      const base = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
      const response = await fetch(`${base}/api/v1/chat/credit`, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || data.code !== 200) throw new Error("Provider authentication failed");
    }
    // Read-only authentication probe. This does not validate paid model capabilities.
    return NextResponse.json({ success: true, provider: body.provider }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Connection test failed. Check the selected provider, API Key and network." }, { status: 400 }); }
}
