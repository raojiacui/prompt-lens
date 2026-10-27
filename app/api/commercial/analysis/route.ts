import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { commercialConsumptionEnabled, prepareCommercialAnalysis, quoteCommercialAnalysis, quoteCommercialAnalysisRetry } from "@/lib/billing/commercial-analysis";
import { taskErrorDetails } from "@/lib/billing/task-diagnostics";

export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!commercialConsumptionEnabled()) return NextResponse.json({ code: "COMMERCIAL_NOT_ENABLED" }, { status: 503 });
  const body = await request.json().catch(() => null);
    if (body?.action === "retry" && typeof body.taskId === "string") {
      if (body.sceneVersionId !== undefined && typeof body.sceneVersionId !== "string") return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
      return NextResponse.json(await quoteCommercialAnalysisRetry(session.user.id, body.taskId, body.sceneVersionId));
    }
    if (body?.action === "prepare" && typeof body.projectId === "string" && typeof body.mediaUrl === "string") {
      return NextResponse.json(await prepareCommercialAnalysis(session.user.id, { projectId: body.projectId, mediaUrl: body.mediaUrl, mediaName: String(body.mediaName || "Video").slice(0, 200), automaticSplit: body.automaticSplit === true }));
    }
    if (body?.action === "quote" && typeof body.preparationId === "string") return NextResponse.json(await quoteCommercialAnalysis(session.user.id, body));
    return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ANALYSIS_QUOTE_UNAVAILABLE";
    const known = /^[A-Z_]+$/.test(code);
    const upstreamFailure = ["MEDIA_PREPARATION_FAILED", "MEDIA_STORAGE_CONFIG_INVALID", "MEDIA_PROBE_NOT_CONFIGURED"].includes(code);
    if (!known || upstreamFailure) console.error("[analysis quote] Request failed", { code: known ? code : "ANALYSIS_QUOTE_UNAVAILABLE", diagnostic: taskErrorDetails(error) });
    return NextResponse.json({ code: known ? code : "ANALYSIS_QUOTE_UNAVAILABLE" }, { status: upstreamFailure ? 503 : known ? 400 : 503 });
  }
}
