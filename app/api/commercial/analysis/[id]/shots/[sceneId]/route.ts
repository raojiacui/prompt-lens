import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, commercialTasks, projects, projectAssets } from "@/lib/db";
import { commercialMediaRequest, type MediaPreview } from "@/lib/billing/commercial-media";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { extractR2Key } from "@/lib/cloudflare/r2";
import { streamShotDownload } from "@/lib/workflow/shot-download";

export const maxDuration = 300;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; sceneId: string }> }) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const { id, sceneId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  const preparation = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, id), eq(commercialTasks.userId, session.user.id), eq(commercialTasks.kind, "analysis_preview")) });
  if (!preparation || preparation.createdAt.getTime() + 7 * 86400000 <= Date.now() || (preparation.input as Record<string, unknown>).retentionExpired) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const source = preparation.input as { projectId: string; mediaUrl: string; automaticSplit: boolean; preview: MediaPreview };
  if (!source.projectId || !Array.isArray(source.preview?.scenes)) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, source.projectId), eq(projects.userId, session.user.id)) });
  if (!project || (project.metadata as Record<string, unknown>)?.retentionExpiredAt) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const index = source.preview.scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  try {
    let url = source.mediaUrl;
    if (source.automaticSplit) {
      const cached = await db.query.projectAssets.findFirst({ where: and(eq(projectAssets.projectId, source.projectId), eq(projectAssets.type, "scene_clip"), sql`${projectAssets.metadata}->>'downloadPreparationId' = ${id}`, sql`${projectAssets.metadata}->>'sceneId' = ${sceneId}`) });
      if (cached) url = cached.url;
      else {
        // Use server-detected boundaries, never client-provided trimming coordinates.
        const interval = source.preview.scenes[index];
        const assets = await commercialMediaRequest<FfmpegBreakdownResult>(source.mediaUrl, { mode: "assets", sourceHash: source.preview.sourceHash, scenes: [interval] });
        const shot = assets.scenes[0];
        if (assets.scenes.length !== 1 || !shot?.clipUrl || Math.abs(shot.startTime * 1e6 - interval.startUs) > 1000 || Math.abs(shot.endTime * 1e6 - interval.endUs) > 1000) throw new Error("SHOT_FILE_UNAVAILABLE");
        const files: { type: "reference_video" | "scene_clip" | "keyframe" | "audio"; url: string }[] = [{ type: "reference_video", url: source.mediaUrl }, { type: "scene_clip", url: shot.clipUrl }];
        shot.keyframeUrls.forEach(url => files.push({ type: "keyframe", url }));
        if (shot.audioUrl) files.push({ type: "audio", url: shot.audioUrl });
        await db.insert(projectAssets).values(files.map(file => ({ ...file, projectId: source.projectId, storageKey: extractR2Key(file.url), metadata: { downloadPreparationId: id, sceneId } })));
        url = shot.clipUrl;
      }
    }
    return await streamShotDownload(url, index + 1, request.signal);
  } catch { return NextResponse.json({ code: "SHOT_FILE_UNAVAILABLE" }, { status: 502 }); }
}
