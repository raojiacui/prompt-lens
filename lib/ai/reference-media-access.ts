import { and, eq } from "drizzle-orm";
import { db, projects, videoScenes } from "@/lib/db";
import { assertOwnedUploadedVideo } from "@/lib/billing/commercial-media";

export type ReferenceMediaContext = { userId: string; projectId?: string };

export async function assertReferenceMediaAccess(context: ReferenceMediaContext, url: string, kind: "image" | "video") {
  try { await assertOwnedUploadedVideo(context.userId, url, kind); return; }
  catch { /* An analyzed project's derived frames and clips are also valid references. */ }
  if (context.projectId) {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, context.projectId), eq(projects.userId, context.userId)) });
    if (project) {
      const scenes = await db.query.videoScenes.findMany({ where: eq(videoScenes.projectId, project.id) });
      if (scenes.some(scene => kind === "video" ? scene.clipUrl === url : Array.isArray(scene.keyframeUrls) && scene.keyframeUrls.includes(url))) return;
    }
  }
  throw new Error("UPLOAD_NOT_OWNED");
}
