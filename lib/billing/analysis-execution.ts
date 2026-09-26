import { and, eq, sql } from "drizzle-orm";
import { commercialTasks, db } from "@/lib/db";

type Task = typeof commercialTasks.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
