import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db, moderationRecords, moderationTerms } from "@/lib/db";
import { isModerationProject } from "./moderation-project";

export const moderationControlsEnabled = isModerationProject;

export const MODERATION_CATEGORIES = [
  "nsfw", "child_safety", "ip", "violence", "hate",
  "self_harm", "deepfake", "public_figures", "other",
] as const;
export type ModerationCategory = typeof MODERATION_CATEGORIES[number];
export type PolicyAction = "block" | "review";
export const normalizeTerm = (s: string) => s.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
export function termMatches(content: string, term: string): boolean {
  const normalized = normalizeTerm(content);
  const needle = normalizeTerm(term);
  if (!needle || needle.length < 2 || needle.length > 160) return false;
  let index = normalized.indexOf(needle);
  while (index >= 0) {
    // Latin words must match a word boundary (avoid blocking "class" for "ass").
    const isLatin = /^[a-z0-9 ]+$/.test(needle);
    const before = normalized[index - 1] ?? "";
    const after = normalized[index + needle.length] ?? "";
    if (!isLatin || (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after))) return true;
    index = normalized.indexOf(needle, index + 1);
  }
  return false;
}
export type PolicyMatch = { id: string; category: string; action: PolicyAction };
export function evaluateTerms(prompt: string, terms: { id: string; normalizedPhrase: string; category: string; action: string }[]): PolicyMatch | null {
  const matches = terms.filter(term => termMatches(prompt, term.normalizedPhrase));
  const winner = matches.sort((a, b) => (a.action === "block" ? -1 : 1) - (b.action === "block" ? -1 : 1))[0];
  return winner ? { id: winner.id, category: winner.category, action: winner.action === "block" ? "block" : "review" } : null;
}
export async function checkDynamicPromptTerms(prompt: string): Promise<PolicyMatch | null> {
  if (!moderationControlsEnabled()) return null;
  // DB failure must be treated as unavailable rather than skipping moderation.
  const terms = await db.select({
    id: moderationTerms.id, normalizedPhrase: moderationTerms.normalizedPhrase,
    category: moderationTerms.category, action: moderationTerms.action,
  }).from(moderationTerms).where(eq(moderationTerms.enabled, true));
  return evaluateTerms(prompt, terms);
}
const safe = (s: string | undefined, max = 128) => s && /^[A-Za-z0-9_.:-]+$/.test(s) ? s.slice(0, max) : undefined;
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
export type AuditEvent = {
  eventKey?: string;
  userId?: string;
  taskId?: string;
  stage: "prompt" | "output" | "manual" | "policy_change";
  provider: string;
  verdict: string;
  category?: string;
  ruleId?: string;
  reasonCode?: string;
  prompt?: string;
  providerRequestId?: string;
  reviewerId?: string;
  relatedRecordId?: string;
  reviewNote?: string;
};
export async function appendModerationRecord(event: AuditEvent): Promise<void> {
  if (!moderationControlsEnabled()) return;
  // No raw prompt/video/URL is persisted. A one-way fingerprint supports correlation.
  await db.insert(moderationRecords).values({
    eventKey: event.eventKey?.slice(0, 180), userId: event.userId,
    taskId: event.taskId?.slice(0, 180), stage: event.stage,
    provider: event.provider.slice(0, 40), verdict: event.verdict.slice(0, 24),
    category: event.category?.slice(0, 32), ruleId: event.ruleId,
    reasonCode: safe(event.reasonCode, 64), referenceHash: event.prompt ? hash(event.prompt) : undefined,
    providerRequestId: safe(event.providerRequestId),
    reviewerId: event.reviewerId, relatedRecordId: event.relatedRecordId,
    reviewNote: event.reviewNote?.slice(0, 1500),
  }).onConflictDoNothing({ target: moderationRecords.eventKey });
}
export async function listModerationTerms() {
  return db.select().from(moderationTerms).orderBy(desc(moderationTerms.updatedAt)).limit(500);
}
export async function latestModerationRecords(limit = 100) {
  return db.select().from(moderationRecords).orderBy(desc(moderationRecords.createdAt)).limit(Math.max(1, Math.min(200, limit)));
}
export async function deleteModerationTerm(id: string, actorId: string) {
  return db.transaction(async tx => {
    const [removed] = await tx.delete(moderationTerms).where(eq(moderationTerms.id, id)).returning();
    if (!removed) throw Error("NOT_FOUND");
    // Preserve the deleted rule's context and all earlier review records.
    // If audit persistence fails, the transaction restores the rule as well.
    await tx.insert(moderationRecords).values({
      stage: "policy_change", provider: "local_terms", verdict: "deleted",
      category: removed.category, ruleId: removed.id, reviewerId: actorId,
      reasonCode: "term_deleted",
      reviewNote: `短语：${removed.phrase}\n处理：${removed.action}\n启用：${removed.enabled}\n修订：${removed.revision}\n备注：${removed.note ?? ""}`,
    });
    return removed.id;
  });
}
export async function updateModerationTerm(input: {
  id?: string; phrase: string; category: ModerationCategory; action: PolicyAction;
  enabled: boolean; note?: string; actorId: string;
}) {
  const phrase = input.phrase.normalize("NFKC").trim();
  const normalizedPhrase = normalizeTerm(phrase);
  if (normalizedPhrase.length < 2 || normalizedPhrase.length > 160) throw Error("INVALID_PHRASE");
  if (!MODERATION_CATEGORIES.includes(input.category)) throw Error("INVALID_CATEGORY");
  if (!["block", "review"].includes(input.action)) throw Error("INVALID_ACTION");
  if (input.note && input.note.length > 500) throw Error("INVALID_NOTE");
  return db.transaction(async tx => {
    if (input.id) {
      const [previous] = await tx.select().from(moderationTerms).where(eq(moderationTerms.id, input.id)).for("update");
      if (!previous) throw Error("NOT_FOUND");
      const [updated] = await tx.update(moderationTerms).set({
        phrase, normalizedPhrase, category: input.category, action: input.action,
        enabled: input.enabled, note: input.note ?? null, updatedBy: input.actorId,
        revision: sql`${moderationTerms.revision} + 1`, updatedAt: new Date(),
      }).where(eq(moderationTerms.id, input.id)).returning();
      await tx.insert(moderationRecords).values({
        stage: "policy_change", provider: "local_terms", verdict: input.enabled ? "updated" : "disabled",
        category: input.category, ruleId: updated.id, reviewerId: input.actorId,
        reasonCode: "term_revision_" + updated.revision,
        reviewNote: input.note?.slice(0, 500) || null,
      });
      return updated;
    }
    const [created] = await tx.insert(moderationTerms).values({
      phrase, normalizedPhrase, category: input.category, action: input.action,
      enabled: input.enabled, note: input.note ?? null, updatedBy: input.actorId,
    }).returning();
    await tx.insert(moderationRecords).values({
      stage: "policy_change", provider: "local_terms", verdict: "created",
      category: input.category, ruleId: created.id, reviewerId: input.actorId,
      reasonCode: "term_revision_1", reviewNote: input.note?.slice(0, 500) || null,
    });
    return created;
  });
}
