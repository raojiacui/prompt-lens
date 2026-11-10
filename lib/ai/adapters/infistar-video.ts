import { randomUUID } from "node:crypto";
import { infistarJson, assertInfistarModel, InfistarRequestError } from "../infistar-client";
import { getModelById } from "../model-registry";
import { uploadToR2 } from "@/lib/cloudflare/r2";
import { db, mediaCleanupJobs } from "@/lib/db";
import { readInfistarMedia } from "../infistar-media";
import { assertReferenceMediaAccess, type ReferenceMediaContext } from "../reference-media-access";
import type { KieVideoGenerationRequest, KieVeoStatus } from "@/lib/reference-video/kie-veo";

export function buildInfistarVideoPayload(input: KieVideoGenerationRequest) {
  const modelId = input.model || "doubao-seedance-2.0-mini";
  const model = getModelById(modelId);
  if (!model || model.provider !== "infistar" || !model.enabled) throw new InfistarRequestError("请选择 Infistar 支持的视频模型。", undefined, "not_sent");
  const images = [...new Set([...(input.imageUrls || []), input.referenceImageUrl].filter((url): url is string => Boolean(url)))];
  if (input.referenceVideoUrl && !model.capabilities.includes("reference_video")) throw new InfistarRequestError("当前型号不支持视频输入，请选择 MiniMax H3。", undefined, "not_sent");
  if (input.referenceVideoUrl && images.length) throw new InfistarRequestError("Infistar 当前文件接口一次接收一个参考素材，请保留参考视频或图片。", undefined, "not_sent");
  if (images.length > 1) throw new InfistarRequestError("Infistar 当前已核实的图生视频接口只接收一张参考图。", undefined, "not_sent");
  if (images.length && !model.capabilities.includes("reference_image")) throw new InfistarRequestError("当前型号不支持参考图片。", undefined, "not_sent");
  if (input.generateAudio || input.cameraFixed || input.seed !== undefined || input.negativePrompt) throw new InfistarRequestError("Infistar 尚未核实这组高级生成参数，请调整后重试。", undefined, "not_sent");
  const seconds = input.duration ?? model.durationOptions?.[0] ?? 4;
  const resolution = input.resolution?.toLowerCase() || model.resolutionOptions?.[0] || "720p";
  const ratio = input.aspectRatio || "16:9";
  if (!model.durationOptions?.includes(seconds) || !model.resolutionOptions?.includes(resolution) || !model.aspectRatios?.includes(ratio)) throw new InfistarRequestError("当前 Infistar 型号不支持所选时长、画质或比例。", undefined, "not_sent");
  const shortSide = resolution === "2k" ? 1440 : Number.parseInt(resolution, 10);
  const [widthRatio, heightRatio] = ratio.split(":").map(Number);
  const width = Math.round(shortSide * Math.max(1, widthRatio / heightRatio) / 2) * 2;
  const height = Math.round(shortSide * Math.max(1, heightRatio / widthRatio) / 2) * 2;
  return { model: model.providerModelId, prompt: input.prompt, seconds: String(seconds), size: resolution === "2k" ? "2K" : `${width}x${height}`, ...(input.referenceVideoUrl || images.length ? { input_reference: input.referenceVideoUrl || images[0] } : {}) };
}

export async function createInfistarVideo(input: KieVideoGenerationRequest, apiKey: string, context?: ReferenceMediaContext) {
  const body = buildInfistarVideoPayload(input);
  await assertInfistarModel(apiKey, body.model);
  let request: unknown = body;
  if (body.input_reference) {
    if (!context) throw new InfistarRequestError("缺少参考素材的账户上下文。", undefined, "not_sent");
    await assertReferenceMediaAccess(context, body.input_reference, input.referenceVideoUrl ? "video" : "image");
    const media = await readInfistarMedia(body.input_reference, input.referenceVideoUrl ? "video" : "image");
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) if (key !== "input_reference") form.set(key, String(value));
    const extension = media.type === "image/jpeg" ? "jpg" : media.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || (input.referenceVideoUrl ? "mp4" : "png");
    form.set("input_reference", media, `reference.${extension}`);
    request = form;
  }
  const raw = await infistarJson("/videos", apiKey, request);
  const taskId = raw.id || raw.task_id || raw.data?.id || raw.data?.task_id;
  if (typeof taskId !== "string" || !taskId) throw new InfistarRequestError("Infistar 未返回任务 ID，请先在服务商后台核对，避免重复提交。", undefined, "unknown");
  return { taskId, raw };
}

export async function getInfistarVideoStatus(taskId: string, apiKey: string): Promise<KieVeoStatus> {
  const raw = await infistarJson(`/videos/${encodeURIComponent(taskId)}`, apiKey);
  const data = raw.data && !Array.isArray(raw.data) ? raw.data : raw;
  if (data.id && data.id !== taskId) throw new InfistarRequestError("Infistar 返回的任务 ID 不匹配。", undefined, "unknown");
  const state = data.status === "completed" ? "success" : data.status === "failed" ? "fail" : "generating";
  const candidate = data.metadata?.url || data.video_url || data.url || (Array.isArray(data.data) ? data.data[0]?.url : undefined);
  let videoUrl: string | undefined;
  if (typeof candidate === "string") {
    try { if (new URL(candidate).protocol === "https:") videoUrl = candidate; } catch { /* wait for a valid result */ }
  }
  if (state === "success" && !videoUrl) {
    // Authenticated content cannot be embedded in the browser. Preserve it in our existing storage.
    const { infistarBaseUrl } = await import("../infistar-client");
    const response = await fetch(`${infistarBaseUrl()}/videos/${encodeURIComponent(taskId)}/content`, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("video/")) throw new InfistarRequestError("Infistar 视频下载暂不可用，请稍后查询原任务。", response.status, "unknown");
    const maxBytes = 100 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maxBytes) throw new InfistarRequestError("Infistar 返回的视频超过存储大小限制。", undefined, "unknown");
    const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > maxBytes) throw new Error("Video size limit exceeded"); chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const storageKey = `generated/infistar/${randomUUID()}.mp4`;
    // Register deletion before uploading so even an interrupted save has a cleanup path.
    await db.insert(mediaCleanupJobs).values({ storageKey, nextAttemptAt: new Date(Date.now() + 7 * 86400000) });
    videoUrl = await uploadToR2(Buffer.concat(chunks), storageKey, "video/mp4");
  }
  return { taskId, state, videoUrl, error: state === "fail" ? "Infistar 视频生成失败，请到服务商后台查看原因。" : undefined, raw };
}
