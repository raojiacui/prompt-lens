/**
 * Staging output moderation reviews the actual generated video via Sightengine,
 * independently of Waffo's text prompt scan. Only an explicit accept unlocks it.
 * https://www.sightengine.com/docs/video-moderation-workflows
 */
const TEST_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
export const requiresVideoOutputModeration = () => process.env.VERCEL_PROJECT_ID === TEST_PROJECT_ID;
export type OutputDecision = "approved" | "review" | "blocked" | "unavailable";
export type OutputVerdict = {
  state: OutputDecision; provider: "sightengine"; requestId?: string;
  code?: "not_configured" | "invalid_url" | "transport" | "provider_error" | "invalid_response";
};
const ENDPOINT = "https://api.sightengine.com/1.0/video/check-workflow-sync.json";
const safeId = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : undefined;

export function parseVideoOutputVerdict(raw: unknown): OutputVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { state: "unavailable", provider: "sightengine", code: "invalid_response" };
  const v = raw as { status?: unknown; summary?: { action?: unknown }; request?: { id?: unknown } };
  const requestId = safeId(v.request?.id);
  if (v.status !== "success") return { state: "unavailable", provider: "sightengine", requestId, code: "provider_error" };
  if (v.summary?.action === "accept") return { state: "approved", provider: "sightengine", requestId };
  if (v.summary?.action === "reject") return { state: "blocked", provider: "sightengine", requestId };
  if (v.summary?.action === "review") return { state: "review", provider: "sightengine", requestId };
  return { state: "unavailable", provider: "sightengine", requestId, code: "invalid_response" };
}

export async function moderateVideoOutput(videoUrl: string, fetcher: typeof fetch = fetch): Promise<OutputVerdict> {
  if (!requiresVideoOutputModeration()) return { state: "unavailable", provider: "sightengine", code: "not_configured" };
  const user = process.env.SIGHTENGINE_API_USER?.trim();
  const secret = process.env.SIGHTENGINE_API_SECRET?.trim();
  const workflow = process.env.SIGHTENGINE_WORKFLOW_ID?.trim();
  if (!user || !secret || !workflow || !/^wfl_[A-Za-z0-9_-]{6,128}$/.test(workflow)) {
    console.warn("[output-moderation] unavailable", { stage: "credentials" });
    return { state: "unavailable", provider: "sightengine", code: "not_configured" };
  }
  let checked: URL;
  try {
    checked = new URL(videoUrl);
    const host = checked.hostname.toLowerCase();
    if (checked.protocol !== "https:" || checked.username || checked.password ||
      !host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
      /^(?:[0-9.]+|\[[a-f0-9:]+\])$/i.test(host) || /(?:^|\.)(?:internal|local|test)$/.test(host)) throw Error("invalid");
  } catch { return { state: "unavailable", provider: "sightengine", code: "invalid_url" }; }
  const body = new URLSearchParams({
    stream_url: checked.toString(), workflow, api_user: user, api_secret: secret,
  });
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body, cache: "no-store", signal: AbortSignal.timeout(25_000),
    });
  } catch {
    console.warn("[output-moderation] unavailable", { stage: "transport" });
    return { state: "unavailable", provider: "sightengine", code: "transport" };
  }
  if (!response.ok) {
    console.warn("[output-moderation] unavailable", { stage: "http", status: response.status });
    return { state: "unavailable", provider: "sightengine", code: "provider_error" };
  }
  const raw: unknown = await response.json().catch(() => null);
  const verdict = parseVideoOutputVerdict(raw);
  console.info("[output-moderation] verdict", {
    state: verdict.state, ...(verdict.requestId ? { requestId: verdict.requestId } : {}),
    ...(verdict.code ? { code: verdict.code } : {}),
  });
  return verdict;
}
