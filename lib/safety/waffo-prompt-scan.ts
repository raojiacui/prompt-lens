import { createHash, createPrivateKey, createSign } from "node:crypto";

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

function normalizeKey(value: string) {
  return createPrivateKey(value.replace(/\\n/g, "\n").trim());
}

/**
 * Only scan the prompt immediately before a video-generation submission or
 * a paid generation quote. Do not call this from LLM chat, analysis or rewrite.
 *
 * "off" turns OFF only Waffo's optional semantic channel; its mandatory
 * keyword/policy scan is still active. Only an explicit allow may generate.
 *
 * Feature flag defaults disabled for safe staging integration. Once enabled,
 * missing credentials, transport failures and unknown results all fail closed.
 */
export async function assertPromptAllowed(prompt: string, options: {
  enabled?: boolean;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  semantic?: SemanticMode;
} = {}): Promise<void> {
  if (options.enabled === false || (options.enabled === undefined && process.env.WAFFO_PROMPT_SCAN_ENABLED !== "true")) return;

  const content = prompt.trim();
  if (!content || content.length > 12000) throw new PromptModerationError("PROMPT_INVALID");

  const merchantId = process.env.WAFFO_MERCHANT_ID;
  const key = process.env.WAFFO_PRIVATE_KEY;
  if (!merchantId || !key) throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");

  const path = "/v1/actions/verification/scan-prompt";
  const payload = JSON.stringify({ prompt: content, semantic: options.semantic ?? "off" });
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
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new PromptModerationError("PROMPT_SCAN_RATE_LIMITED",
        Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600 ? seconds : undefined);
    }
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  const envelope = result as { data?: { action?: unknown; reasonCode?: unknown }; errors?: unknown[] } | null;
  if (!envelope?.data || (Array.isArray(envelope.errors) && envelope.errors.length)) {
    throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
  }
  const { action, reasonCode } = envelope.data;
  if (reasonCode === "service_degraded") throw new PromptModerationError("PROMPT_REVIEW_REQUIRED");
  if (action === "allow") return;
  if (action === "block") throw new PromptModerationError("PROMPT_BLOCKED");
  if (action === "review") throw new PromptModerationError("PROMPT_REVIEW_REQUIRED");
  throw new PromptModerationError("PROMPT_SCAN_UNAVAILABLE");
}
