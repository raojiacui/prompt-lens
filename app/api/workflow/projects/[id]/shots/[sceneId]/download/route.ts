import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, projects, videoScenes } from "@/lib/db";
import { streamShotDownload } from "@/lib/workflow/shot-download";

export const maxDuration = 90;
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; sceneId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  const { id, sceneId } = await params;
  if (![id, sceneId].every(value => /^[0-9a-f-]{36}$/i.test(value))) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
  const project = await db.query.projects.findFirst({ where: and(eq(projects.id, id), eq(projects.userId, session.user.id)) });
  if (!project || (project.metadata as Record<string, unknown>)?.retentionExpiredAt) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  const scene = await db.query.videoScenes.findFirst({ where: and(eq(videoScenes.id, sceneId), eq(videoScenes.projectId, id)) });
  if (!scene?.clipUrl) return NextResponse.json({ code: "SHOT_NOT_FOUND" }, { status: 404 });
  try { return await streamShotDownload(scene.clipUrl, scene.sceneIndex, request.signal); }
  catch { return NextResponse.json({ code: "SHOT_FILE_UNAVAILABLE" }, { status: 502 }); }
}
