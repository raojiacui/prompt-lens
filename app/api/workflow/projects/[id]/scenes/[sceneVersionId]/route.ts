import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, sceneVersions } from "@/lib/db";
import { getProjectForUser } from "@/lib/workflow/service";
import { and, eq } from "drizzle-orm";

const editableKeys = ["story", "visual", "dialogue", "narration", "subtitle", "audio", "transition", "generationPrompt", "duration"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sceneVersionId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sceneVersionId } = await params;
  const project = await getProjectForUser(id, session.user.id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await request.json().catch(() => null) || {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of editableKeys) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const [scene] = await db
    .update(sceneVersions)
    .set(updates)
    .where(and(eq(sceneVersions.id, sceneVersionId), eq(sceneVersions.projectId, id)))
    .returning();

  if (!scene) return NextResponse.json({ error: "Scene version not found" }, { status: 404 });
  return NextResponse.json({ scene });
}