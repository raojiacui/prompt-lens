import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { scriptVideoSettingsSchema, compileScriptVideo } from "./script-video-compiler";
import type { FullVideoScript } from "./full-video-script";

const snapshotSchema = z.object({
  compilerVersion: z.literal(1), generationId: z.string().uuid(), userId: z.string().min(1), projectId: z.string().uuid(), versionId: z.string().uuid(),
  revision: z.number().int().positive(), scriptRevisionId: z.string(), sourceHash: z.string().length(64), expiresAt: z.number().int(),
  settings: scriptVideoSettingsSchema, prompt: z.string().min(1).max(20480),
  sourceTimeline: z.array(z.object({ id: z.string().uuid(), sceneIndex: z.number().int().nonnegative(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() }).strict()).min(1).max(100),
}).strict();
export type ScriptVideoSnapshot = z.infer<typeof snapshotSchema>;
const secret = () => {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("SCRIPT_VIDEO_PREVIEW_UNAVAILABLE");
  return value;
};
const signature = (encoded: string) => createHmac("sha256", secret()).update(`full-script-video:v1:${encoded}`).digest();
export function signScriptVideoPreview(input: { userId: string; projectId: string; versionId: string; revision: number; content: FullVideoScript; settings: z.infer<typeof scriptVideoSettingsSchema>; editedPrompt?: string }) {
  const compiled = compileScriptVideo(input.content, input.settings, input.editedPrompt);
  const snapshot: ScriptVideoSnapshot = { compilerVersion: 1, generationId: randomUUID(), userId: input.userId, projectId: input.projectId, versionId: input.versionId,
    revision: input.revision, scriptRevisionId: `${input.versionId}:${input.revision}`, sourceHash: createHash("sha256").update(JSON.stringify(input.content)).digest("hex"),
    expiresAt: Date.now() + 600000, settings: input.settings, prompt: compiled.prompt, sourceTimeline: compiled.sourceTimeline };
  const encoded = Buffer.from(JSON.stringify(snapshot)).toString("base64url");
  return { snapshot, token: `${encoded}.${signature(encoded).toString("base64url")}`, payload: compiled.payload };
}
export function verifyScriptVideoPreview(token: string, userId: string, projectId: string, allowExpired = false) {
  try {
    if (token.length > 150000) throw Error();
    const [encoded, supplied, extra] = token.split(".");
    if (!encoded || !supplied || extra) throw Error();
    const expected = signature(encoded), actual = Buffer.from(supplied, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error();
    const snapshot = snapshotSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (snapshot.userId !== userId || snapshot.projectId !== projectId) throw Error();
    if (!allowExpired && snapshot.expiresAt <= Date.now()) throw new Error("SCRIPT_VIDEO_PREVIEW_EXPIRED");
    return snapshot;
  } catch (error) {
    if (error instanceof Error && error.message === "SCRIPT_VIDEO_PREVIEW_EXPIRED") throw error;
    throw new Error("SCRIPT_VIDEO_INVALID_PREVIEW");
  }
}
