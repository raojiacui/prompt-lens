import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { commercialTasks, db, mediaCleanupJobs, projectAssets, projects, projectVersions, referenceVideos, sceneVersions, videoGeneration, videoScenes, workflowJobs } from "@/lib/db";
import { collectProjectR2Keys } from "./service";

export const MEDIA_RETENTION_DAYS = 7;

// User edits to titles and polling timestamps do not extend content retention.
const contentCreatedAt = sql`greatest(
  ${projects.createdAt},
  coalesce((select max(created_at) from project_versions where project_id = ${projects.id}), ${projects.createdAt}),
  coalesce((select max(created_at) from scene_versions where project_id = ${projects.id}), ${projects.createdAt}),
  coalesce((select max(created_at) from reference_videos where project_id = ${projects.id}), ${projects.createdAt}),
  coalesce((select max(updated_at) from commercial_tasks where user_id = ${projects.userId}
    and input->>'projectId' = ${projects.id}::text and kind in ('analysis','workflow_analysis')
    and state in ('completed','failed')), ${projects.createdAt})
)`;

const eligible = sql`${projects.metadata}->>'retentionExpiredAt' is null
  and ${projects.status} <> 'analyzing'
  and ${contentCreatedAt} <= now() - interval '7 days'
  and not exists (select 1 from commercial_tasks where user_id = ${projects.userId}
    and input->>'projectId' = ${projects.id}::text
    and (state in ('queued','running','review') or (state = 'quoted' and expires_at > now())))
  and not exists (select 1 from workflow_jobs where project_id = ${projects.id} and status in ('queued','processing'))
  and not exists (select 1 from video_generation where project_id = ${projects.id}
    and user_id = ${projects.userId} and status in ('pending','queued','processing','running'))`;

export async function expireProjectMedia(limit = 10, dryRun = false) {
  const candidates = await db.select({ id: projects.id, userId: projects.userId }).from(projects)
    .where(eligible).orderBy(asc(projects.createdAt)).limit(limit);
  if (dryRun) return { eligible: candidates.length, expired: 0 };
  let expired = 0;
  for (const candidate of candidates) {
    const didExpire = await db.transaction(async tx => {
      // Recheck after acquiring the lock; concurrent cleanup runs cannot expire twice.
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, candidate.id), eq(projects.userId, candidate.userId), eligible)).for("update");
      if (!project) return false;
      const keys = await collectProjectR2Keys(project.id, tx, false);
      for (const storageKey of keys) {
        await tx.insert(mediaCleanupJobs).values({ storageKey }).onConflictDoUpdate({
          target: mediaCleanupJobs.storageKey,
          set: { state: "pending", attempts: 0, nextAttemptAt: new Date(), deletedAt: null, lastError: null, updatedAt: new Date() },
        });
      }
      await tx.delete(sceneVersions).where(eq(sceneVersions.projectId, project.id));
      await tx.delete(videoScenes).where(eq(videoScenes.projectId, project.id));
      await tx.delete(referenceVideos).where(eq(referenceVideos.projectId, project.id));
      await tx.delete(projectVersions).where(eq(projectVersions.projectId, project.id));
      await tx.delete(projectAssets).where(and(eq(projectAssets.projectId, project.id), notInArray(projectAssets.type, ["generated_video", "final_video"])));
      await tx.delete(workflowJobs).where(and(eq(workflowJobs.projectId, project.id), notInArray(workflowJobs.type, ["GENERATE_VIDEO", "RENDER_VIDEO"])));
      // Keep generation results, but remove copied analysis prompts from old job payloads.
      await tx.update(workflowJobs).set({ input: {} }).where(eq(workflowJobs.projectId, project.id));
      const tasks = await tx.select().from(commercialTasks).where(and(eq(commercialTasks.userId, project.userId),
        sql`${commercialTasks.input}->>'projectId' = ${project.id}`, inArray(commercialTasks.kind, ["analysis", "workflow_analysis", "analysis_preview"])));
      for (const task of tasks) {
        const result = task.result as Record<string, unknown>;
        await tx.update(commercialTasks).set({
          state: task.state === "quoted" ? "failed" : task.state,
          input: { projectId: project.id, retentionExpired: true },
          result: { projectId: project.id, retentionExpired: true, chargedCredits: result.chargedCredits, totalChargedCredits: result.totalChargedCredits },
        }).where(eq(commercialTasks.id, task.id));
      }
      // No cascade into payment, credit or refund records. Provider-hosted videos stay accessible in generation history.
      await tx.update(videoGeneration).set({ sceneId: null, projectVersionId: null }).where(and(eq(videoGeneration.projectId, project.id), eq(videoGeneration.userId, project.userId)));
      await tx.update(projects).set({ status: "archived", activeVersionId: null, description: null,
        metadata: { retentionExpiredAt: new Date().toISOString(), retentionDays: MEDIA_RETENTION_DAYS }, updatedAt: new Date() }).where(eq(projects.id, project.id));
      return true;
    });
    if (didExpire) expired++;
  }
  return { eligible: candidates.length, expired };
}
