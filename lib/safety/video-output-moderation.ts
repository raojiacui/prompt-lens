/**
 * Generated-video review using Google Cloud Video Intelligence.
 * The Video Intelligence API is asynchronous, so never publish a video while
 * the Google operation is still pending. This API detects adult content only.
 * https://cloud.google.com/video-intelligence/docs/feature-explicit-content
 */
import { createSign, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isModerationProject } from "./moderation-project";

const API = "https://videointelligence.googleapis.com/v1";
const TOKEN = "https://oauth2.googleapis.com/token";
const STORAGE = "https://storage.googleapis.com";
const INLINE_LIMIT = 8 * 1024 * 1024;
const MAX_DOWNLOAD = 50 * 1024 * 1024;
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export const requiresVideoOutputModeration = isModerationProject;
export type OutputDecision = "checking" | "approved" | "review" | "blocked" | "unavailable";
export type OutputVerdict = {
  state: OutputDecision;
  provider: "google_video_intelligence";
  operationName?: string;
  stagedObject?: string;
  code?: "not_configured" | "invalid_url" | "video_too_large" | "transport" | "provider_error" | "invalid_response";
};

const verdict = (state: OutputDecision, extra: Omit<OutputVerdict, "state" | "provider"> = {}): OutputVerdict =>
  ({ state, provider: "google_video_intelligence", ...extra });

type ServiceAccount = { type: "service_account"; client_email: string; private_key: string };
function credentials(): ServiceAccount | null {
  try {
    const value: unknown = JSON.parse(process.env.GOOGLE_VIDEO_MODERATION_SERVICE_ACCOUNT_JSON || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Partial<ServiceAccount>;
    if (item.type !== "service_account" || typeof item.private_key !== "string" ||
        typeof item.client_email !== "string" || !item.client_email.endsWith(".gserviceaccount.com")) return null;
    return item as ServiceAccount;
  } catch { return null; }
}

async function accessToken(account: ServiceAccount, fetcher: typeof fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." +
    b64({ iss: account.client_email, scope: SCOPE, aud: TOKEN, iat: now, exp: now + 3500 });
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = unsigned + "." + signer.sign(account.private_key, "base64url");
  const response = await fetcher(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error("token");
  const data = await response.json() as { access_token?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) throw Error("token");
  return data.access_token;
}

const publicIp = (value: string) => {
  // Refuse local and special address ranges; the generation result is a remote URL.
  const v = value.toLowerCase();
  if (isIP(v) === 4) {
    const n = v.split(".").map(Number);
    return !(n[0] === 0 || n[0] === 10 || n[0] === 127 || n[0] >= 224 ||
      (n[0] === 169 && n[1] === 254) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168) || (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
      (n[0] === 192 && n[1] === 0) || (n[0] === 198 && [18, 19].includes(n[1])));
  }
  if (isIP(v) === 6) return !(v === "::1" || v === "::" || v.startsWith("fe80:") ||
    v.startsWith("fc") || v.startsWith("fd") || v.startsWith("::ffff:"));
  return false;
};

async function safeVideoUrl(input: string): Promise<URL | null> {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      !hostname.includes(".") || isIP(hostname) || hostname === "localhost" ||
      /(?:^|\.)(?:localhost|local|internal|test)$/.test(hostname)) return null;
    // Block DNS names that currently resolve to private/reserved IP addresses.
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(item => !publicIp(item.address))) return null;
    return url;
  } catch { return null; }
}

async function downloadVideo(url: URL, fetcher: typeof fetch): Promise<Buffer> {
  const response = await fetcher(url.toString(), {
    method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok || !response.body || response.status >= 300) throw Error("download");
  const advertised = Number(response.headers.get("content-length"));
  if (advertised > MAX_DOWNLOAD) throw Error("too_large");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD) throw Error("too_large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!total) throw Error("download");
  return Buffer.concat(chunks, total);
}

function bucketName(): string | null {
  const name = process.env.GOOGLE_VIDEO_MODERATION_GCS_BUCKET?.trim();
  return name && /^(?!goog)[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(name) ? name : null;
}
async function uploadVideo(buffer: Buffer, token: string, fetcher: typeof fetch): Promise<{ uri: string; stagedObject: string }> {
  const bucket = bucketName();
  if (!bucket) throw Error("too_large");
  const object = "prompt-lens-test-output-review/" + randomUUID() + ".mp4";
  const url = `${STORAGE}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`;
  const response = await fetcher(url, {
    method: "POST", headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "video/mp4",
    }, body: new Uint8Array(buffer), cache: "no-store", signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw Error("upload");
  return { uri: `gs://${bucket}/${object}`, stagedObject: `${bucket}/${object}` };
}

function safeOperationName(name: unknown): string | undefined {
  return typeof name === "string" &&
    /^(?:(?:projects\/[a-zA-Z0-9_-]+\/locations\/[a-zA-Z0-9_-]+\/)?operations\/[a-zA-Z0-9_.-]+)$/.test(name)
    ? name : undefined;
}

export function parseVideoOutputVerdict(value: unknown): OutputVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return verdict("unavailable", { code: "invalid_response" });
  const response = value as {
    done?: unknown; name?: unknown; error?: unknown;
    response?: { annotationResults?: { explicitAnnotation?: { frames?: { pornographyLikelihood?: unknown }[] }; error?: unknown }[] };
  };
  const operationName = safeOperationName(response.name);
  if (response.error) return verdict("unavailable", { operationName, code: "provider_error" });
  // Google omits the default false `done` field on pending REST operations.
  if (response.done === false || response.done === undefined) return operationName && response.response === undefined
    ? verdict("checking", { operationName })
    : verdict("unavailable", { code: "invalid_response" });
  if (response.done !== true) return verdict("unavailable", { code: "invalid_response" });
  const results = response.response?.annotationResults;
  if (!Array.isArray(results) || results.length !== 1 || results[0]?.error) {
    return verdict("unavailable", { operationName, code: "invalid_response" });
  }
  const frames = results[0]?.explicitAnnotation?.frames;
  if (!Array.isArray(frames) || !frames.length) return verdict("review", { operationName });
  const likelihoods = frames.map(frame => frame.pornographyLikelihood);
  if (likelihoods.some(v => v === "VERY_LIKELY" || v === "LIKELY" || v === 5 || v === 4))
    return verdict("blocked", { operationName });
  if (likelihoods.some(v => !["VERY_UNLIKELY", "UNLIKELY", 1, 2].includes(v as string | number)))
    return verdict("review", { operationName });
  return verdict("approved", { operationName });
}

export async function moderateVideoOutput(videoUrl: string, fetcher: typeof fetch = fetch): Promise<OutputVerdict> {
  if (!requiresVideoOutputModeration()) return verdict("unavailable", { code: "not_configured" });
  const account = credentials();
  if (!account) return verdict("unavailable", { code: "not_configured" });
  const url = await safeVideoUrl(videoUrl);
  if (!url) return verdict("unavailable", { code: "invalid_url" });

  let stagedObject: string | undefined;
  try {
    const token = await accessToken(account, fetcher);
    const content = await downloadVideo(url, fetcher);
    const upload = content.byteLength > INLINE_LIMIT ? await uploadVideo(content, token, fetcher) : undefined;
    stagedObject = upload?.stagedObject;
    const body = upload
      ? { inputUri: upload.uri, features: ["EXPLICIT_CONTENT_DETECTION"] }
      : { inputContent: content.toString("base64"), features: ["EXPLICIT_CONTENT_DETECTION"] };
    const response = await fetcher(`${API}/videos:annotate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw Error("provider");
    const raw: unknown = await response.json().catch(() => null);
    const result = parseVideoOutputVerdict(raw);
    if (result.state === "unavailable") {
      if (stagedObject) await removeStagedModerationVideo(stagedObject, fetcher);
      return result;
    }
    return { ...result, stagedObject };
  } catch (error) {
    const code = error instanceof Error && error.message === "too_large"
      ? "video_too_large" : error instanceof Error && error.message === "provider" ? "provider_error" : "transport";
    console.warn("[output-moderation] Google submission unavailable", { code });
    if (stagedObject) await removeStagedModerationVideo(stagedObject, fetcher);
    return verdict("unavailable", { code });
  }
}

export async function pollVideoOutputModeration(operationName: string, fetcher: typeof fetch = fetch): Promise<OutputVerdict> {
  const account = credentials();
  const name = safeOperationName(operationName);
  if (!requiresVideoOutputModeration() || !account) return verdict("unavailable", { code: "not_configured", operationName: name });
  if (!name) return verdict("unavailable", { code: "invalid_response" });
  try {
    const token = await accessToken(account, fetcher);
    const response = await fetcher(`${API}/${name}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw Error("provider");
    const raw: unknown = await response.json().catch(() => null);
    return parseVideoOutputVerdict(raw);
  } catch {
    console.warn("[output-moderation] Google operation unavailable");
    return verdict("unavailable", { code: "transport", operationName: name });
  }
}

export async function removeStagedModerationVideo(stagedObject: string | undefined, fetcher: typeof fetch = fetch): Promise<void> {
  if (!stagedObject || !requiresVideoOutputModeration()) return;
  const bucket = bucketName();
  const prefix = bucket ? bucket + "/prompt-lens-test-output-review/" : "";
  if (!bucket || !stagedObject.startsWith(prefix) || !/^[a-z0-9._/-]+$/i.test(stagedObject)) return;
  const account = credentials();
  if (!account) return;
  try {
    const token = await accessToken(account, fetcher);
    const object = stagedObject.slice(bucket.length + 1);
    await fetcher(`${STORAGE}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
  } catch { console.warn("[output-moderation] temp object cleanup deferred"); }
}
