import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWorkflowAnalysisEntitlement } from "@/lib/billing/video-analysis";
import { getCommercialRewriteBalance } from "@/lib/billing/commercial-rewrite";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entitlement = await getWorkflowAnalysisEntitlement(session.user.id);
  const commercial = await getCommercialRewriteBalance(session.user.id);
  return NextResponse.json({
    balance: entitlement.balance,
    commercial,
    commercialConsumptionEnabled: process.env.COMMERCIAL_CONSUMPTION_ENABLED === "true",
    mode: entitlement.mode,
    hasPaidVideoAnalysis: entitlement.hasPaidVideoAnalysis,
    hasUserKieKey: entitlement.hasUserKieKey,
    canUsePlatformKie: entitlement.canUsePlatformKie,
    platformKieConfigured: entitlement.platformKieConfigured,
    trial: entitlement.trial,
    capabilities: entitlement.capabilities,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
