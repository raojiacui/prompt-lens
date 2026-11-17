import { createHash, createPrivateKey, createSign } from "node:crypto";

export type ModerationVerdict = "allow" | "review" | "block";

export class PromptModerationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PromptModerationError";
  }
}

function normalizeKey(value: string) {
  const key = value.replace(/\\n/g, "\n").trim();
  return createPrivateKey(key);
}

/**
 * The flag defaults off to avoid disrupting existing production generation
 * before a sandbox credential and the full end-to-end test suite are ready.
 * When enabled, missing credentials and all transport failures fail closed.
 */
export async function assertPromptAllowed(prompt: string, options: {
  enabled?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  semantic?: "off" | "shadow" | "enforce";
} = {}): Promise<void> {
  if (options.enabled === false || (options.enabled === undefined && process.env.WAFFO_PROMPT_SCAN_ENABLED !== "true")) return;
  const content = prompt.trim();
  if (!content || content.length > 12000) throw new PromptModerationError("PROMPT_INVALID");
  const merchantId = process.env.WAFFO_MERCHANT_ID;
  const key = process.env.WAFFO_PRIVATE_KEY;
  if (!merchantId || !key) throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");

  const path = "/v1/actions/verification/scan-prompt";
  const payload = JSON.stringify({ prompt: content, semantic: options.semantic ?? "shadow" });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  let signature: string;
  try {
    const canonical = ["POST", path, timestamp, createHash("sha256").update(payload).digest("base64")].join("\n");
    const signer = createSign("sha256");
    signer.update(canonical);
    signature = signer.sign(normalizeKey(key), "base64");
  } catch {
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)("https://api.waffo.ai" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Merchant-Id": merchantId,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
      },
      body: payload,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
  } catch {
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new PromptModerationError(response.status === 429 ? "PROMPT_SCAN_RATE_LIMITED" : "PROMPT_SCAN_UNAVAILABLE");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  const envelope = result as { data?: { action?: unknown }; errors?: unknown[] } | null;
  if (!envelope?.data || (Array.isArray(envelope.errors) && envelope.errors.length)) {
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  const action = envelope.data.action;
  if (action === "allow") return;
  if (action === "block") throw new PromptModerationError("PROMPT_BLOCKED");
  if (action === "review") throw new PromptModerationError("PROMPT_REVIEW_REQUIRED");
  throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
}
