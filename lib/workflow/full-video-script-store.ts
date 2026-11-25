import { and, eq } from "drizzle-orm";
import { db, projects, projectVersions } from "@/lib/db";
import { getProjectBundle } from "./service";
import { buildFullVideoScript, validateScriptBoundaries, type ScriptDocument, type FullVideoScript } from "./full-video-script";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function lockedScriptVersion(tx: Transaction, userId: string, projectId: string, versionId: string) {
  const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).for("update");
  if (!project || (project.metadata as Record<string, unknown>).retentionExpiredAt) throw new Error("SCRIPT_NOT_FOUND");
  const [version] = await tx.select().from(projectVersions).where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId))).for("update");
  if (!version) throw new Error("SCRIPT_NOT_FOUND");
  return version;
}
export function storedScript(metadata: unknown): ScriptDocument | undefined {
  return (metadata as { fullVideoScript?: ScriptDocument })?.fullVideoScript;
}
export async function writeScript(tx: Transaction, version: typeof projectVersions.$inferSelect, document: ScriptDocument) {
  await tx.update(projectVersions).set({ metadata: { ...(version.metadata as object), fullVideoScript: document } }).where(eq(projectVersions.id, version.id));
}

export async function readFullVideoScript(userId: string, projectId: string, versionId: string, zh: boolean): Promise<ScriptDocument> {
  const bundle = await getProjectBundle(projectId, userId);
  if (!bundle || (bundle.project.metadata as Record<string, unknown>).retentionExpiredAt) throw new Error("SCRIPT_NOT_FOUND");
  const version = bundle.versions.find(v => v.id === versionId);
  if (!version) throw new Error("SCRIPT_NOT_FOUND");
  const existing = storedScript(version.metadata);
  if (existing) return existing;
  const versions = bundle.allSceneVersions.filter(v => v.projectVersionId === versionId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = versions.filter((v, index) => versions.findIndex(other => other.originalSceneId === v.originalSceneId) === index);
  if (!bundle.scenes.length) throw new Error("SCRIPT_NO_SCENES");
  const content = buildFullVideoScript(bundle.project.title, version.overview as Record<string, unknown>, bundle.scenes, latest.map(v => ({ ...v,
    story: v.story as Record<string, unknown>, visual: v.visual as Record<string, unknown>, audio: v.audio as Record<string, unknown>,
    transition: v.transition as Record<string, unknown>, metadata: v.metadata as Record<string, unknown>,
    dialogue: v.dialogue as unknown[], narration: v.narration as unknown[], subtitle: v.subtitle as unknown[] })), zh);
  return db.transaction(async tx => {
    const row = await lockedScriptVersion(tx, userId, projectId, versionId);
    const saved = storedScript(row.metadata);
    if (saved) return saved;
    const contentCreatedAt = Math.max(bundle.project.createdAt.getTime(), ...bundle.versions.map(v => v.createdAt.getTime()),
      ...bundle.allSceneVersions.map(v => v.createdAt.getTime()), ...bundle.referenceVideos.map(v => v.createdAt.getTime()));
    const document: ScriptDocument = { revision: 1, content, savedAt: new Date().toISOString(),
      expiresAt: new Date(contentCreatedAt + 7 * 86400000).toISOString(), history: [], candidates: [] };
    await writeScript(tx, row, document);
    return document;
  });
}

export async function saveFullVideoScript(input: { userId: string; projectId: string; versionId: string; revision: number; content?: FullVideoScript; candidateId?: string; undo?: boolean }) {
  return db.transaction(async tx => {
    const row = await lockedScriptVersion(tx, input.userId, input.projectId, input.versionId);
    const current = storedScript(row.metadata);
    if (!current) throw new Error("SCRIPT_NOT_FOUND");
    if (current.revision !== input.revision) throw new Error("SCRIPT_CONFLICT");
    const candidate = input.candidateId ? current.candidates.find(c => c.requestId === input.candidateId) : undefined;
    if (input.candidateId && (!candidate || candidate.sourceRevision !== current.revision)) throw new Error("SCRIPT_CONFLICT");
    const content = input.undo ? current.history.at(-1)?.content : candidate?.content ?? input.content;
    if (!content) throw new Error("SCRIPT_NO_REVISION");
    validateScriptBoundaries(current.content, content);
    const document: ScriptDocument = { ...current, revision: current.revision + 1, content,
      savedAt: new Date().toISOString(), history: [...current.history, { revision: current.revision, content: current.content, savedAt: current.savedAt }].slice(-20) };
    await writeScript(tx, row, document);
    return document;
  });
}
