import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getVideoAnalysisEntitlement } from "@/lib/billing/video-analysis";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entitlement = await getVideoAnalysisEntitlement(session.user.id);
  return NextResponse.json({
    balance: entitlement.balance,
    mode: entitlement.mode,
    hasPaidVideoAnalysis: entitlement.hasPaidVideoAnalysis,
    hasUserKieKey: entitlement.hasUserKieKey,
    canUsePlatformKie: entitlement.canUsePlatformKie,
    platformKieConfigured: entitlement.platformKieConfigured,
    trial: entitlement.trial,
    capabilities: entitlement.capabilities,
  });
}
