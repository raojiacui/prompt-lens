import { and, eq, sql } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";

type Task = typeof commercialTasks.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The task routes are capped at five minutes, so a six-minute lease cannot
// overtake a live invocation but recovers a terminated one promptly.
export const ANALYSIS_STALE_TIMEOUT_MS = 6 * 60_000;
export const ANALYSIS_SAVE_STALE_TIMEOUT_MS = 60_000;

export function analysisNeedsRecovery(task: Task, now = Date.now()) {
  if (task.kind !== "analysis") return false;
  if ((task.input as { executionMode?: string }).executionMode === "scene_jobs_v1" && (task.result as { sceneJobMode?: string }).sceneJobMode === "independent_v1") return false;
  if (task.state === "queued") return task.updatedAt.getTime() < now - 24 * 3600_000;
  if (!["running", "review"].includes(task.state)) return false;
  const checkpoint = (task.result as Record<string, unknown>).pendingResult;
  const timeout = checkpoint ? ANALYSIS_SAVE_STALE_TIMEOUT_MS : ANALYSIS_STALE_TIMEOUT_MS;
  return task.updatedAt.getTime() < now - timeout;
}

export class AnalysisExecutionLost extends Error {
  constructor() { super("ANALYSIS_EXECUTION_LOST"); }
}

export function executionCondition(task: Task) {
  const executionId = (task.result as Record<string, unknown>).executionId;
  return and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "running"),
    sql`${commercialTasks.result}->>'executionId' = ${executionId}`);
}

// Lock before writing results or money, so reconciliation cannot overtake a commit.
export async function lockAnalysisExecution(tx: Transaction, task: Task) {
  const [current] = await tx.select().from(commercialTasks).where(executionCondition(task)).for("update");
  if (!current) throw new AnalysisExecutionLost();
  return current;
}
