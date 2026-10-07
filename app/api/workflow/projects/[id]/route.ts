import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteProjectForUser, getProjectBundle } from "@/lib/workflow/service";
import { and, eq } from "drizzle-orm";
import { db, commercialTasks } from "@/lib/db";
import { findPaidSplit, type PreparedAnalysisSource } from "@/lib/billing/commercial-split";
import type { FfmpegBreakdownResult } from "@/lib/ffmpeg-worker/client";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const bundle = await getProjectBundle(id, session.user.id);
  if (!bundle) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const preparationId = (bundle.project.metadata as Record<string, unknown>)?.splitPreparationId;
  if (bundle.project.status === "draft" && typeof preparationId === "string") {
    const preparation = await db.query.commercialTasks.findFirst({ where: and(eq(commercialTasks.id, preparationId), eq(commercialTasks.userId, session.user.id), eq(commercialTasks.kind, "analysis_preview"), eq(commercialTasks.state, "quoted")) });
    if (preparation && preparation.expiresAt.getTime() > Date.now()) {
      const source = preparation.input as PreparedAnalysisSource;
      if (source.projectId !== id || !source.preview?.scenes) return NextResponse.json(bundle);
      const paid = await findPaidSplit(session.user.id, source);
      const assets = (paid?.result as { assets?: FfmpegBreakdownResult } | undefined)?.assets;
      return NextResponse.json({ ...bundle, splitSource: {
        projectId: id, mediaUrl: source.mediaUrl, mediaName: source.mediaName, automaticSplit: true,
        preparation: { id: preparation.id, durationUs: source.preview.durationUs, scenes: source.preview.scenes, paidSplitReusable: Boolean(paid), splitClips: assets?.scenes.map((scene, index) => ({ id: source.preview.scenes[index].id, clipUrl: scene.clipUrl })) },
      } });
    }
  }
  return NextResponse.json(bundle);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await deleteProjectForUser(id, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete project";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
