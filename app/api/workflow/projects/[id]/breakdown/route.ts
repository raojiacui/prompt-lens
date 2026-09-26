import { after, NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enqueueAnalysis, runAnalysisTask } from "@/lib/workflow/analysis-tasks";
import { videoAnalysisBillingErrorResponse } from "@/lib/billing/video-analysis";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export const maxDuration = 300;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const limit = await checkRateLimit(`workflow-analysis:${session.user.id}`, 5, 60000);
    if (!limit.allowed) return NextResponse.json({ error: "提交过于频繁，请稍后重试。" }, { status: 429 });
    const body = await request.json();
    const { id } = await params;
    const task = await enqueueAnalysis(session.user.id, id, body);
    if (task.state === "queued") after(() => runAnalysisTask(task.id));
    return NextResponse.json({ taskId: task.id, state: task.state }, { status: 202 });
  } catch (error) {
    const billingError = videoAnalysisBillingErrorResponse(error);
    if (billingError) return NextResponse.json(billingError, { status: 402 });
    const message = error instanceof Error ? error.message : "Analysis submission failed";
    return NextResponse.json({ error: message, code: message === "CONFIRMED_QUOTE_REQUIRED" ? message : undefined }, { status: 409 });
  }
}
