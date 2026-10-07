import { and, eq, sql } from "drizzle-orm";
import { db, commercialTasks, projects, projectAssets } from "@/lib/db";
import { commercialMediaRequest, type MediaPreview } from "./commercial-media";
import { splitCredits, PRICING_VERSION } from "./pricing-v6";
import { lockAnalysisExecution } from "./analysis-execution";
import { settleCommercialTaskInTransaction } from "./commercial-wallet";
import { extractR2Key } from "@/lib/cloudflare/r2";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import type { AnalysisInput } from "./commercial-analysis";

export type PreparedAnalysisSource = { projectId: string; mediaUrl: string; mediaName: string; preview: MediaPreview; automaticSplit: boolean };
type Connection = Pick<typeof db, "query">;

export async function findPaidSplit(userId: string, source: PreparedAnalysisSource, connection: Connection = db) {
  return connection.query.commercialTasks.findFirst({ where: and(
    eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis"), eq(commercialTasks.state, "completed"),
    sql`${commercialTasks.input}->>'projectId' = ${source.projectId}`,
    sql`${commercialTasks.input}->>'splitOnly' = 'true'`,
    sql`${commercialTasks.input}->'preview'->>'sourceHash' = ${source.preview.sourceHash}`,
    sql`${commercialTasks.result}->>'splitDelivered' = 'true'`,
  ) });
}

export async function quoteCommercialSplit(userId: string, preparationId: string) {
  return db.transaction(async tx => {
    const preparation = await tx.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, preparationId), eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis_preview"), eq(commercialTasks.state, "quoted")) });
    if (!preparation) throw new Error("QUOTE_EXPIRED");
    const source = preparation.input as PreparedAnalysisSource;
    if (!source.automaticSplit) throw new Error("SPLIT_NOT_REQUIRED");
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, source.projectId), eq(projects.userId, userId))).for("update");
    if (!project || (project.metadata as Record<string, unknown>)?.retentionExpiredAt) throw new Error("PROJECT_NOT_FOUND");
    const paid = await findPaidSplit(userId, source, tx);
    if (paid) return { id: paid.id, credits: 0, state: paid.state, splitDelivered: true };
    if (preparation.expiresAt.getTime() < Date.now()) throw new Error("QUOTE_EXPIRED");
    const active = await tx.query.commercialTasks.findFirst({ where: and(
      eq(commercialTasks.userId, userId), eq(commercialTasks.kind, "analysis"),
      sql`${commercialTasks.input}->>'projectId' = ${source.projectId}`,
      sql`${commercialTasks.input}->>'splitOnly' = 'true'`,
      sql`${commercialTasks.input}->'preview'->>'sourceHash' = ${source.preview.sourceHash}`,
      sql`(${commercialTasks.state} IN ('queued','running','review') OR (${commercialTasks.state} = 'quoted' AND ${commercialTasks.expiresAt} > now()))`,
    ) });
    if (active) return { id: active.id, credits: active.credits, state: active.state, splitDelivered: false };
    if (project.status !== "draft") throw new Error("PROJECT_NOT_READY");
    const credits = splitCredits(source.preview.durationUs);
    const input: AnalysisInput = { ...source, splitOnly: true, preparationId, pricing: {
      payer: "byok_split", model: "flash", sourceDurationUs: source.preview.durationUs,
      automaticSplit: true, paidSplitReusable: false, scenes: source.preview.scenes,
    }, outputLanguage: "zh", keyFingerprint: "split-only", pricingVersion: PRICING_VERSION };
    const [task] = await tx.insert(commercialTasks).values({ userId, kind: "analysis", input, credits, expiresAt: new Date(Date.now() + 600000) }).returning();
    return { id: task.id, credits, state: task.state, splitDelivered: false };
  });
}

export async function executeCommercialSplit(task: typeof commercialTasks.$inferSelect) {
  const input = task.input as AnalysisInput;
  let assets: FfmpegBreakdownResult;
  try {
    assets = await commercialMediaRequest<FfmpegBreakdownResult>(input.mediaUrl, { mode: "assets", sourceHash: input.preview.sourceHash, scenes: input.preview.scenes });
    if (assets.scenes.length !== input.preview.scenes.length || assets.scenes.some((scene, index) => !scene.clipUrl || Math.abs(scene.startTime * 1e6 - input.preview.scenes[index].startUs) > 1000 || Math.abs(scene.endTime * 1e6 - input.preview.scenes[index].endUs) > 1000)) throw new Error("SPLIT_ASSET_MISMATCH");
  } catch {
    await db.transaction(async tx => {
      await lockAnalysisExecution(tx, task);
      await settleCommercialTaskInTransaction(tx, { userId: task.userId, taskKey: `commercial:${task.id}`, credits: 0, rewrites: 0 });
      await tx.update(commercialTasks).set({ state: "failed", result: { splitDelivered: false, chargedCredits: 0, code: "SPLIT_FAILED", projectId: input.projectId }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
      await tx.update(projects).set({ status: "draft", updatedAt: new Date() }).where(eq(projects.id, input.projectId));
    });
    return;
  }
  await db.transaction(async tx => {
    await lockAnalysisExecution(tx, task);
    const files: { type: "reference_video" | "scene_clip" | "keyframe" | "audio"; url: string }[] = [{ type: "reference_video", url: input.mediaUrl }];
    for (const scene of assets.scenes) {
      files.push({ type: "scene_clip", url: scene.clipUrl! });
      scene.keyframeUrls.forEach(url => files.push({ type: "keyframe", url }));
      if (scene.audioUrl) files.push({ type: "audio", url: scene.audioUrl });
    }
    await tx.insert(projectAssets).values(files.map(file => ({ ...file, projectId: input.projectId, storageKey: extractR2Key(file.url), metadata: { splitTaskId: task.id } })));
    await settleCommercialTaskInTransaction(tx, { userId: task.userId, taskKey: `commercial:${task.id}`, credits: task.credits, rewrites: 0 });
    await tx.update(commercialTasks).set({ state: "completed", result: { assets, splitDelivered: true, chargedCredits: task.credits, totalChargedCredits: task.credits, projectId: input.projectId }, updatedAt: new Date() }).where(eq(commercialTasks.id, task.id));
    await tx.update(projects).set({ status: "draft", metadata: sql`(${projects.metadata} - 'analysisTaskId' - 'analysisTaskKind') || ${JSON.stringify({ splitPreparationId: input.preparationId })}::jsonb`, updatedAt: new Date() }).where(eq(projects.id, input.projectId));
    await tx.update(commercialTasks).set({ expiresAt: new Date(Date.now() + 7 * 86400000) }).where(eq(commercialTasks.id, input.preparationId!));
  });
}
