import { createHash } from "node:crypto";
import { getUserCredential } from "@/lib/byok/credentials";
import type { UserProvider } from "@/lib/ai/providers";
import { getPlatformKieApiKey, resolveApiKeyForFeature } from "./platform-access";

export function generationKeyFingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function resolveGenerationStatusKey(userId: string, rawResponse: unknown, provider: UserProvider = "kie") {
  const billing = (rawResponse as { billing?: { keySource?: string; keyFingerprint?: string } } | null)?.billing;
  if (!billing?.keySource) {
    const own = await getUserCredential(userId, provider);
    if (own) return own.apiKey;
    if (provider !== "kie") return null;
    const access = await resolveApiKeyForFeature(userId, { allowPaidPlatformKey: false });
    return access.provider === "kie" ? access.apiKey : null;
  }
  const key = billing.keySource === "user" ? (await getUserCredential(userId, provider))?.apiKey
    : provider === "kie" && ["platform_admin", "platform_paid"].includes(billing.keySource) ? getPlatformKieApiKey() : null;
  if (key && billing.keyFingerprint && generationKeyFingerprint(key) !== billing.keyFingerprint) throw new Error("KIE_TASK_KEY_CHANGED");
  return key;
}
