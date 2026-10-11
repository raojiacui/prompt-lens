import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";
import { runCommercialTask } from "@/lib/billing/commercial-task-runner";
import { recoverCommercialAnalysisTasks } from "@/lib/billing/commercial-analysis";
import { analysisNeedsRecovery } from "@/lib/billing/analysis-execution";
import { runAnalysisTask } from "@/lib/workflow/analysis-tasks";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "";
  const provided = request.headers.get("authorization") || "";
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(provided) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.taskId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.taskId)) return NextResponse.json({ error: "Invalid task" }, { status: 400 });
  let task = await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, body.taskId) });
  if (task && analysisNeedsRecovery(task)) {
    await recoverCommercialAnalysisTasks(task.id);
    task = await db.query.commercialTasks.findFirst({ where: eq(commercialTasks.id, body.taskId) });
  }
  if (!task || task.state !== "queued" || !["analysis", "workflow_analysis"].includes(task.kind)) return NextResponse.json({ state: "not_queued" });
  after(() => task.kind === "workflow_analysis" ? runAnalysisTask(task.id) : runCommercialTask(task.id));
  return NextResponse.json({ state: "scheduled" });
}
