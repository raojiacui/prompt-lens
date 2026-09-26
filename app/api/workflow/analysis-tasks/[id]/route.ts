import { after, NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { commercialTasks, db } from "@/lib/db";
import { getProjectBundle } from "@/lib/workflow/service";
import { recoverAnalysisTasks, runAnalysisTask } from "@/lib/workflow/analysis-tasks";

export const maxDuration = 300;
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid task" }, { status: 400 });
  let task = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, id), eq(commercialTasks.userId, session.user.id), eq(commercialTasks.kind, "workflow_analysis")) });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.state === "running" && task.updatedAt.getTime() < Date.now() - 6 * 60000) {
    await recoverAnalysisTasks();
    task = (await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, id) }))!;
  }
  if (task.state === "queued") after(() => runAnalysisTask(id));
  const result = task.result as { cursor: number; assets?: { scenes: unknown[] }; phase: string; error?: string; partial?: boolean; chargedCredits?: number };
  const input = task.input as { projectId: string };
  const terminal = ["completed", "failed"].includes(task.state);
  return NextResponse.json({ taskId: id, state: task.state, phase: result.phase, completedScenes: result.cursor, totalScenes: result.assets?.scenes.length || 0, partial: result.partial, error: result.error, chargedCredits: result.chargedCredits, bundle: terminal ? await getProjectBundle(input.projectId, session.user.id) : undefined }, { headers: { "Cache-Control": "private, no-store" } });
}
