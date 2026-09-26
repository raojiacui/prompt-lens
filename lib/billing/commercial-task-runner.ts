import { and, eq, sql } from "drizzle-orm";
import { db, commercialTasks, projects } from "@/lib/db";
import { reserveCommercialTaskInTransaction } from "./commercial-wallet";
import { commercialConsumptionEnabled, executeCommercialAnalysis } from "./commercial-analysis";
import { executeCommercialGeneration } from "./commercial-generation";

export async function confirmCommercialTask(userId: string, taskId: string) {
  if (!commercialConsumptionEnabled()) throw new Error("COMMERCIAL_NOT_ENABLED");
  return db.transaction((tx) => confirmCommercialTaskInTransaction(tx, userId, taskId));
}

export async function confirmCommercialTaskInTransaction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string, taskId: string) {
    const [task] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.userId, userId))).for("update");
    if (!task || !["analysis", "generation"].includes(task.kind)) throw new Error("TASK_NOT_FOUND");
    if (task.state !== "quoted") return task;
    if (task.expiresAt.getTime() < Date.now()) throw new Error("QUOTE_EXPIRED");
    if (task.kind === "generation") {
      const projectId = (task.input as { projectId?: string }).projectId;
      if (projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).for("update");
        if (!project) throw new Error("PROJECT_NOT_FOUND");
      }
    }
    if (task.kind === "analysis") {
      const input = task.input as { projectId: string; retry?: { parentId: string } };
      if (input.retry) {
        const [parent] = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.id, input.retry.parentId), eq(commercialTasks.userId, userId))).for("update");
        if (!parent || !["completed", "failed"].includes(parent.state) || (parent.result as Record<string, unknown>).nextTaskId) throw new Error("USE_LATEST_RETRY_TASK");
        await tx.update(commercialTasks).set({ result: sql`${commercialTasks.result} || ${JSON.stringify({ nextTaskId: task.id })}::jsonb` }).where(eq(commercialTasks.id, parent.id));
      }
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.userId, userId))).for("update");
      if (!project || (input.retry ? !["ready", "failed"].includes(project.status) : project.status !== "draft")) throw new Error("PROJECT_NOT_READY");
      await tx.update(projects).set({ status: "analyzing", updatedAt: new Date() }).where(eq(projects.id, project.id));
    }
    await reserveCommercialTaskInTransaction(tx, { userId, taskKey: `commercial:${task.id}`, credits: task.credits, rewrites: 0, quote: task.input as Record<string, unknown> });
    const [queued] = await tx.update(commercialTasks).set({ state: "queued", updatedAt: new Date() }).where(eq(commercialTasks.id, task.id)).returning();
    return queued;
}

export async function runCommercialTask(taskId: string) {
  const [task] = await db.update(commercialTasks).set({ state: "running", updatedAt: new Date() }).where(and(eq(commercialTasks.id, taskId), eq(commercialTasks.state, "queued"), sql`${commercialTasks.kind} IN ('analysis', 'generation')`)).returning();
  if (!task) return;
  try {
    if (task.kind === "analysis") await executeCommercialAnalysis(task);
    else if (task.kind === "generation") await executeCommercialGeneration(task);
    else throw new Error("MODEL_ADAPTER_NOT_READY");
  } catch {
    // Preserve funds and durable results for reconciliation. Never resubmit unknown inference.
    await db.update(commercialTasks).set({ state: "review", result: sql`${commercialTasks.result} || '{"code":"TASK_REQUIRES_RECONCILIATION"}'::jsonb`, updatedAt: new Date() }).where(and(eq(commercialTasks.id, task.id), eq(commercialTasks.state, "running")));
  }
}
