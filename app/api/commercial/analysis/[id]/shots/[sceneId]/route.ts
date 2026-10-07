import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, commercialTasks, projects } from "@/lib/db";
import { findPaidSplit, type PreparedAnalysisSource } from "@/lib/billing/commercial-split";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";
import { streamShotDownload } from "@/lib/workflow/shot-download";

export const maxDuration = 90;
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; sceneId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const { id, sceneId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  const preparation = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, id), eq(commercialTasks.userId, session.user.id), eq(commercialTasks.kind, "analysis_preview")) });
  if (!preparation || (preparation.input as Record<string, unknown>).retentionExpired) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const source = preparation.input as PreparedAnalysisSource;
  if (!source.projectId || !Array.isArray(source.preview?.scenes)) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, source.projectId), eq(projects.userId, session.user.id)) });
  if (!project || (project.metadata as Record<string, unknown>)?.retentionExpiredAt) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const index = source.preview.scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  let url = source.mediaUrl;
  if (source.automaticSplit) {
    const paid = await findPaidSplit(session.user.id, source);
    const asset = (paid?.result as { assets?: FfmpegBreakdownResult } | undefined)?.assets?.scenes[index];
    if (!asset?.clipUrl) return NextResponse.json({ code: "SPLIT_NOT_READY" }, { status: 409 });
    url = asset.clipUrl;
  }
  try { return await streamShotDownload(url, index + 1, request.signal); }
  catch { return NextResponse.json({ code: "SHOT_FILE_UNAVAILABLE" }, { status: 502 }); }
}
