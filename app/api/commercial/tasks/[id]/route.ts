import { after, NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, commercialTasks } from "@/lib/db";
import { commercialAnalysisBundle, recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { confirmCommercialTask, runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { reconcileCommercialGeneration } from "@/lib/billing/commercial-generation";
import { recoverAnalysisTasks, runAnalysisTask } from "@/lib/workflow/analysis-tasks";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: "INVALID_TASK" }, { status: 400 });
  try {
    const task = await confirmCommercialTask(session.user.id, id);
    if (task.state === "queued") after(() => runCommercialTask(task.id));
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
  if (task.kind === "analysis" && ["running", "review"].includes(task.state) && task.updatedAt.getTime() < Date.now() - 6 * 60000) {
    await recoverCommercialAnalysisTasks();
    task = (await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, id) }))!;
  }
  if (task.kind === "workflow_analysis" && task.state === "running" && task.updatedAt.getTime() < Date.now() - 6 * 60000) {
    await recoverAnalysisTasks();
    task = (await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, id) }))!;
  }
  if (task.state === "queued") after(() => task!.kind === "workflow_analysis" ? runAnalysisTask(id) : runCommercialTask(id));
  if (task.kind === "generation" && task.state === "running") {
    try { await reconcileCommercialGeneration(task.id); } catch { /* A query failure does not fail the task. */ }
    task = (await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, id) }))!;
  }
  const result = task.result as Record<string, unknown>;
  const input = task.input as { pricing?: { scenes: unknown[] } };
  const success = Array.isArray(result.successfulSceneIds) ? result.successfulSceneIds.length : 0;
  const retryAvailable = task.kind === "analysis" && ["completed", "failed"].includes(task.state) && !result.nextTaskId && Boolean(result.assets) && success < (input.pricing?.scenes.length || 0);
  const bundle = ["analysis", "workflow_analysis"].includes(task.kind) && ["completed", "failed"].includes(task.state) ? await commercialAnalysisBundle(task) : undefined;
  return NextResponse.json({ id: task.id, kind: task.kind, state: task.state, credits: task.credits, chargedCredits: result.chargedCredits, projectId: result.projectId, bundle, videoUrl: result.videoUrl, retryAvailable, nextTaskId: result.nextTaskId }, { headers: { "Cache-Control": "private, no-store" } });
}
