import { createHash, createPrivateKey, createSign } from "node:crypto";
import { isModerationProject } from "./moderation-project";

export type ModerationVerdict = "allow" | "review" | "block";
type SemanticMode = "off" | "shadow" | "enforce";

export class PromptModerationError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number) {
    super(code);
    this.name = "PromptModerationError";
  }
}

/** Consistent user-safe HTTP responses; no raw prompt or model-provider detail is exposed. */
export function promptModerationHttpFailure(error: unknown):
  | { status: 400 | 422 | 429 | 503; body: { code: string; error: string; retryAfter?: number } }
  | null {
  if (!(error instanceof PromptModerationError)) return null;
  const messages: Record<string, [400 | 422 | 429 | 503, string]> = {
    PROMPT_INVALID: [400, "请输入有效的视频生成提示词。"],
    PROMPT_BLOCKED: [422, "提示词未通过安全检查，未启动视频生成。"],
    PROMPT_REVIEW_REQUIRED: [422, "提示词需要进一步审核，暂时无法生成视频。"],
    PROMPT_SCAN_RATE_LIMITED: [429, "提示词审核请求过多，请稍后重试。"],
    PROMPT_SCAN_UNAVAILABLE: [503, "提示词安全审核暂时不可用，请稍后重试。"],
  };
  const [status, message] = messages[error.code] ?? messages.PROMPT_SCAN_UNAVAILABLE;
  return {
    status,
    body: {
      code: error.code,
      error: message,
      ...(error.retryAfterSeconds ? { retryAfter: error.retryAfterSeconds } : {}),
    },
  };
}

type ScanFailureStage = "credentials" | "signing" | "transport" | "http" | "json" | "envelope" | "verdict";

// Emit only bounded diagnostic metadata; never log prompt, body, headers or keys.
function unavailable(stage: ScanFailureStage, details: { status?: number; requestId?: string | null } = {}) {
  const requestId = details.requestId;
  console.warn("[prompt-scan] unavailable", {
    stage,
    ...(details.status !== undefined ? { status: details.status } : {}),
    ...(requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? { requestId } : {}),
  });
  return new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
}

function normalizeKey(value: string) {
  return createPrivateKey(value.replace(/\\n/g, "\n").trim());
}

/**
 * Only scan immediately before video generation or a paid generation quote.
 * On managed live and test deployments, safety scanning is mandatory even if the
 * feature flag was mis-scoped, so a skipped check can never look like "passed".
 * With an enabled scan, only Waffo's explicit allow can submit generation.
 * Other projects retain their environment-controlled behavior.
 */
export async function assertPromptAllowed(prompt: string, options: {
  enabled?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  semantic?: SemanticMode;
  userId?: string;
} = {}): Promise<void> {
  return runPromptReview(prompt, options);
}

async function scanWaffoPrompt(prompt: string, options: {
  enabled?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  semantic?: SemanticMode;
  userId?: string;
} = {}): Promise<void> {
  const mandatory = isModerationProject();
  if (options.enabled === false && !mandatory) return;
  if (options.enabled !== true && !mandatory && process.env.WAFFO_PROMPT_SCAN_ENABLED !== "true") {
    console.warn("[prompt-scan] skipped", { reason: "not_enabled" });
    return;
  }

  const content = prompt.trim();
  if (!content || content.length > 10_000) throw new PromptModerationError("PROMPT_INVALID");

  const merchantId = process.env.WAFFO_MERCHANT_ID;
  const key = process.env.WAFFO_PRIVATE_KEY;
  if (!merchantId || !key) throw unavailable("credentials");

  const path = "/v1/actions/verification/scan-prompt";
  const semantic = mandatory ? "enforce" : options.semantic ?? "off";
  const payload = JSON.stringify({ prompt: content, semantic });
  const timestamp = Math.floor(Date.now() / 1000).toString();

  let signature: string;
  try {
    const canonical = ["POST", path, timestamp, createHash("sha256").update(payload).digest("base64")].join("\n");
    const signer = createSign("sha256");
    signer.update(canonical);
    signature = signer.sign(normalizeKey(key), "base64");
  } catch {
    throw unavailable("signing");
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
    throw unavailable("transport");
  }
  if (!response.ok) {
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new PromptModerationError("PROMPT_SCAN_RATE_LIMITED",
        Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600 ? seconds : undefined);
    }
    throw unavailable("http",  { status: response.status, requestId: response.headers.get("x-request-id") });
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw unavailable("json");
  }
  const envelope = result as { data?: { action?: unknown; reasonCode?: unknown; requestId?: unknown; semanticStatus?: unknown }; errors?: unknown[] } | null;
  if (!envelope?.data || (Array.isArray(envelope.errors) && envelope.errors.length)) {
    throw unavailable("envelope");
  }
  const { action, reasonCode, requestId, semanticStatus } = envelope.data;
  const safeReason = ["allowed", "review_required", "restricted_content", "service_degraded"].includes(String(reasonCode))
    ? reasonCode : "other";
  const safeSemantic = ["disabled", "scored", "shadow_scored", "provider_error"].includes(String(semanticStatus))
    ? semanticStatus : "unreported";
  // Log only bounded categorical metadata, never the prompt, API key or body.
  console.info("[prompt-scan] verdict", {
    action: ["allow", "review", "block"].includes(String(action)) ? action : "unknown",
    reasonCode: safeReason,
    semanticStatus: safeSemantic,
    ...(typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId) ? { requestId } : {}),
  });
  // Do not label degraded/disabled semantic enforcement as a passed check.
  if (reasonCode === "service_degraded" ||
    (semantic === "enforce" && semanticStatus !== "scored")) {
    throw new PromptModerationError("PROMPT_REVIEW_REQUIRED");
  }
  if (action === "allow") return;
  if (action === "block") throw new PromptModerationError("PROMPT_BLOCKED");
  if (action === "review") throw new PromptModerationError("PROMPT_REVIEW_REQUIRED");
  throw unavailable("verdict");
}

/**
 * Managed deployments run dynamic policy before Waffo. Both local and Waffo
 * decisions produce durable, content-minimal audit records. Never silently
 * bypass either safety gate on DB, network or provider failure.
 */
async function runPromptReview(prompt: string, options: {
  enabled?: boolean; fetcher?: typeof fetch; timeoutMs?: number; semantic?: SemanticMode;
  userId?: string;
}): Promise<void> {
  const mandatory = isModerationProject();
  if (options.enabled === false && !mandatory) return;
  if (!mandatory) return scanWaffoPrompt(prompt, options);
  const { appendModerationRecord, checkDynamicPromptTerms } = await import("./moderation-controls");
  const normalized = prompt.trim();
  let local;
  try { local = await checkDynamicPromptTerms(normalized); }
  catch {
    await appendModerationRecord({
      userId: options.userId, stage: "prompt", provider: "local_terms", verdict: "unavailable",
      reasonCode: "term_store_unavailable", prompt: normalized,
    }).catch(() => {});
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  if (local) {
    await appendModerationRecord({
      userId: options.userId, stage: "prompt", provider: "local_terms", verdict: local.action,
      category: local.category, ruleId: local.id, reasonCode: "dynamic_policy",
      prompt: normalized,
    });
    throw new PromptModerationError(local.action === "block" ? "PROMPT_BLOCKED" : "PROMPT_REVIEW_REQUIRED");
  }
  try {
    await scanWaffoPrompt(prompt, options);
    await appendModerationRecord({
      userId: options.userId, stage: "prompt", provider: "waffo_prompt_sift", verdict: "allow", reasonCode: "scored", prompt: normalized,
    });
  } catch (error) {
    const code = error instanceof PromptModerationError ? error.code : "PROMPT_SCAN_UNAVAILABLE";
    const verdict = code === "PROMPT_BLOCKED" ? "block" :
      code === "PROMPT_REVIEW_REQUIRED" ? "review" : "unavailable";
    await appendModerationRecord({
      userId: options.userId, stage: "prompt", provider: "waffo_prompt_sift", verdict, reasonCode: code, prompt: normalized,
    });
    throw error;
  }
}
