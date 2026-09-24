import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getUserTrialUsage,
  getUsableUserAnalyzeApiKeyProvider,
} from "@/lib/usage/trial-quota";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [quota, ownKeyProvider] = await Promise.all([
    getUserTrialUsage(session.user.id),
    getUsableUserAnalyzeApiKeyProvider(session.user.id, "kie"),
  ]);

  return NextResponse.json({
    limit: quota.limit,
    used: quota.used,
    remaining: quota.isAdmin ? null : quota.remaining,
    isAdmin: quota.isAdmin,
    hasOwnApiKey: ownKeyProvider === "kie",
  });
}
