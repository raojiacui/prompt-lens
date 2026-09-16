import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { commercialConsumptionEnabled } from "@/lib/billing/commercial-analysis";
import { quoteCommercialGeneration } from "@/lib/billing/commercial-generation";
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!commercialConsumptionEnabled()) return NextResponse.json({ code: "COMMERCIAL_NOT_ENABLED" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  try { return NextResponse.json(await quoteCommercialGeneration(session.user.id, body)); }
  catch (e) { const code = e instanceof Error ? e.message : "GENERATION_QUOTE_UNAVAILABLE"; return NextResponse.json({ code: /^[A-Z_]+$/.test(code) ? code : "GENERATION_QUOTE_UNAVAILABLE" }, { status: 400 }); }
}
