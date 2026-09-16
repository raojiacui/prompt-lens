import { createHash } from "node:crypto";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { getPlatformKieApiKey, resolveKieApiKeyForFeature } from "./platform-access";

export function generationKeyFingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function resolveGenerationStatusKey(userId: string, rawResponse: unknown) {
  const billing = (rawResponse as { billing?: { keySource?: string; keyFingerprint?: string } } | null)?.billing;
  if (!billing?.keySource) return (await resolveKieApiKeyForFeature(userId, { allowPaidPlatformKey: false })).apiKey;
  const key = billing.keySource === "user" ? await getUserKieApiKey(userId)
    : ["platform_admin", "platform_paid"].includes(billing.keySource) ? getPlatformKieApiKey() : null;
  if (key && billing.keyFingerprint && generationKeyFingerprint(key) !== billing.keyFingerprint) throw new Error("KIE_TASK_KEY_CHANGED");
  return key;
}
