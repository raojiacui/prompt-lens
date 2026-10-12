import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";
import { runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { analysisNeedsRecovery } from "@/lib/billing/analysis-execution";
import { runAnalysisTask } from "@/lib/workflow/analysis-tasks";
import { runIndependentSceneJob } from "@/lib/billing/independent-scene-analysis";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const taskId = typeof body?.taskId === "string" ? body.taskId : null;
  const sceneJobId = typeof body?.sceneJobId === "string" ? body.sceneJobId : null;
  if ((Boolean(taskId) === Boolean(sceneJobId)) || !/^[0-9a-f-]{36}$/i.test(taskId || sceneJobId || "")) return NextResponse.json({ error: "Invalid task" }, { status: 400 });
  after(async () => {
    try {
      if (sceneJobId) { await runIndependentSceneJob(sceneJobId); return; }
      let task = await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, taskId!) });
      if (task && analysisNeedsRecovery(task)) {
        await recoverCommercialAnalysisTasks(task.id);
        task = await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, body.taskId) });
      }
      if (!task || task.state !== "queued" || !["analysis", "workflow_analysis"].includes(task.kind)) return;
      if (task.kind === "workflow_analysis") await runAnalysisTask(task.id);
      else await runCommercialTask(task.id);
    } catch (error) {
      console.error("analysis.run.failed", { taskId: taskId || sceneJobId, message: error instanceof Error ? error.message : "Unknown error" });
    }
  });
  return NextResponse.json({ state: "scheduled" });
}
