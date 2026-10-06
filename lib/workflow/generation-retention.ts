import { and, eq, inArray, sql } from "drizzle-orm";
import { commercialTasks, db, videoGeneration } from "@/lib/db";

export async function expireGenerationHistory() {
  if (process.env.NODE_ENV !== "production") return { expiredGenerations: 0 };
  return db.transaction(async tx => {
    const removed = await tx.delete(videoGeneration).where(and(
      sql`${videoGeneration.createdAt} <= now() - interval '7 days'`,
      inArray(videoGeneration.status, ["completed", "failed", "success", "fail", "cancelled"]),
      sql`not exists (select 1 from commercial_tasks where provider_task_id = ${videoGeneration.taskId} and state in ('queued','running','review'))`,
    )).returning({ id: videoGeneration.id });
    // Preserve financial audit rows, removing only expired creative content and result links.
    await tx.update(commercialTasks).set({
      input: { retentionExpired: true },
      result: sql`(${commercialTasks.result} - 'videoUrl' - 'error') || '{"retentionExpired":true}'::jsonb`,
    }).where(and(eq(commercialTasks.kind, "generation"),
      inArray(commercialTasks.state, ["completed", "failed"]),
      sql`${commercialTasks.createdAt} <= now() - interval '7 days'`,
      sql`coalesce(${commercialTasks.input}->>'retentionExpired', 'false') <> 'true'`,
    ));
    return { expiredGenerations: removed.length };
  });
}
