import { after, NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, commercialTasks } from "@/lib/db";
import { commercialAnalysisBundle, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { confirmCommercialTask, runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";
import { recoverAnalysisTasks, runAnalysisTask } from "@/lib/workflow/analysis-tasks";
import { analysisNeedsRecovery } from "@/lib/billing/analysis-execution";
import { resumeIndependentAnalysis } from "@/lib/billing/independent-scene-analysis";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: "INVALID_TASK" }, { status: 400 });
  try {
    let task = await confirmCommercialTask(session.user.id, id);
    if (task.state === "queued" && task.kind === "generation") {
      await runCommercialTask(task.id);
      task = (await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, id), eq(commercialTasks.userId, session.user.id)) }))!;
    } else if (task.state === "queued") after(() => runCommercialTask(task.id));
    return NextResponse.json({ id: task.id, state: task.state, credits: task.credits });
  } catch (e) {
    const code = e instanceof Error ? e.message : "TASK_CONFIRMATION_UNKNOWN";
    return NextResponse.json({ code: /^[A-Z_]+$/.test(code) ? code : "TASK_CONFIRMATION_UNKNOWN" }, { status: code === "INSUFFICIENT_COMMERCIAL_BALANCE" ? 402 : 409 });
  }
}
export async function GET(request: NextRequest, { params }: Context) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: "INVALID_TASK" }, { status: 400 });
  let task = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, id), eq(commercialTasks.userId, session.user.id)) });
  if (!task) return NextResponse.json({ code: "TASK_NOT_FOUND" }, { status: 404 });
  if (task.kind === "analysis" && task.state === "running" && (task.result as { sceneJobMode?: string }).sceneJobMode === "independent_v1") {
    after(async () => {
      try { await resumeIndependentAnalysis(id); }
      catch (error) { console.error("commercial.scene.poll_recovery_failed", { taskId: id, message: error instanceof Error ? error.message : "Unknown error" }); }
    });
  }
  if (analysisNeedsRecovery(task)) {
    after(async () => {
      try {
        await recoverCommercialAnalysisTasks(id);
        await runCommercialTask(id);
      } catch (error) {
        console.error("analysis.recovery.failed", { taskId: id, message: error instanceof Error ? error.message : "Unknown error" });
      }
    });
  }
  if (task.kind === "workflow_analysis" && ((task.state === "running" && task.updatedAt.getTime() < Date.now() - 6 * 60000) || (task.state === "queued" && task.expiresAt.getTime() < Date.now()))) {
    after(async () => {
      try {
        await recoverAnalysisTasks();
        await runAnalysisTask(id);
      } catch (error) {
        console.error("workflow.analysis.recovery_failed", { taskId: id, message: error instanceof Error ? error.message : "Unknown error" });
      }
    });
  }
  if (task.state === "queued") after(() => task!.kind === "workflow_analysis" ? runAnalysisTask(id) : runCommercialTask(id));
  if (task.kind === "generation" && ["running", "review"].includes(task.state)) {
    try { await reconcileCommercialGeneration(task.id); } catch { /* A query failure does not fail the task. */ }
    task = (await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, id) }))!;
  }
  const result = task.result as Record<string, unknown>;
  const input = task.input as { pricing?: { scenes: unknown[] }; retry?: { sceneVersions: unknown[] } };
  const success = Array.isArray(result.successfulSceneIds) ? result.successfulSceneIds.length : 0;
  const retryAvailable = task.kind === "analysis" && ["completed", "failed"].includes(task.state) && !result.nextTaskId && Boolean(result.assets) && success < (input.pricing?.scenes.length || 0);
  const totalScenes = task.kind === "workflow_analysis" ? (result.assets as { scenes?: unknown[] } | undefined)?.scenes?.length || 0 : input.retry?.sceneVersions.length ?? input.pricing?.scenes.length ?? 0;
  const completedScenes = task.kind === "workflow_analysis" ? Number(result.cursor || 0) : Array.isArray(result.finishedSceneIds) ? result.finishedSceneIds.length : 0;
  let bundle: Awaited<ReturnType<typeof commercialAnalysisBundle>> | undefined;
  if (["analysis", "workflow_analysis"].includes(task.kind) && (["completed", "failed"].includes(task.state) || completedScenes > 0)) {
    try { bundle = await commercialAnalysisBundle(task); }
    catch (error) { console.error("analysis.bundle.unavailable", { taskId: id, message: error instanceof Error ? error.message : "Unknown error" }); }
  }
  const partial = task.kind === "workflow_analysis" ? Boolean(result.partial) : success > 0 && success < (input.pricing?.scenes.length || 0);
  const phase = task.kind === "analysis" ? !result.assets ? "preparing" : completedScenes < totalScenes ? "analyzing" : "saving" : undefined;
  const saveRecoveryPending = task.kind === "analysis" && task.state === "review" && Boolean(result.pendingResult);
  return NextResponse.json({ id: task.id, kind: task.kind, state: task.state, phase, progressUpdatedAt: task.updatedAt.getTime(), saveRecoveryPending, credits: task.credits, chargedCredits: result.chargedCredits, projectId: result.projectId, bundle, videoUrl: result.videoUrl, retryAvailable, nextTaskId: result.nextTaskId, totalScenes, completedScenes, partial, error: result.error, reviewReason: (result.review as { reason?: string } | undefined)?.reason }, { headers: { "Cache-Control": "private, no-store" } });
}
