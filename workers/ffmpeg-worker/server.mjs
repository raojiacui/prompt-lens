import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.FFMPEG_WORKER_SECRET || "";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ENDPOINT = process.env.R2_ENDPOINT || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
const SCENE_THRESHOLD = process.env.SCENE_THRESHOLD || "0.32";
const MAX_SCENE_SECONDS = Number(process.env.MAX_SCENE_SECONDS || 8);
const MIN_SCENE_SECONDS = Number(process.env.MIN_SCENE_SECONDS || 0.6);
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_PATH = process.env.FFPROBE_PATH || "ffprobe";
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";
const PYSCENEDETECT_ENABLED = process.env.PYSCENEDETECT_ENABLED !== "false";
const PYSCENEDETECT_SCRIPT_PATH = process.env.PYSCENEDETECT_SCRIPT_PATH || path.join(process.cwd(), "scene-detect.py");
const PYSCENEDETECT_DETECTOR = ["adaptive", "content"].includes(process.env.PYSCENEDETECT_DETECTOR)
  ? process.env.PYSCENEDETECT_DETECTOR
  : "adaptive";
const PYSCENEDETECT_THRESHOLD = Number(process.env.PYSCENEDETECT_THRESHOLD || 27);
const PYSCENEDETECT_ADAPTIVE_THRESHOLD = Number(process.env.PYSCENEDETECT_ADAPTIVE_THRESHOLD || 3);
const MAX_RESOLVE_SECONDS = Number(process.env.MAX_RESOLVE_SECONDS || 600);
const MAX_RESOLVE_BYTES = Number(process.env.MAX_RESOLVE_BYTES || 1024 * 1024 * 1024);
const MUSIC_RECOGNITION_PREVIEW_SECONDS = Number(process.env.MUSIC_RECOGNITION_PREVIEW_SECONDS || 12);

function requireEnv() {
  const missing = [
    ["WORKER_SECRET", WORKER_SECRET],
    ["R2_ENDPOINT or R2_ACCOUNT_ID", R2_ENDPOINT],
    ["R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID],
    ["R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY],
    ["R2_BUCKET_NAME", R2_BUCKET],
    ["R2_PUBLIC_URL", R2_PUBLIC_URL],
  ].filter(([, value]) => !value);
  if (missing.length) throw new Error(`Missing env: ${missing.map(([name]) => name).join(", ")}`);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  forcePathStyle: true,
  credentials: R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY ? {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  } : undefined,
});

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertAuth(req) {
  if (!WORKER_SECRET) throw new Error("WORKER_SECRET is not configured");
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${WORKER_SECRET}`) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`${path.basename(command)} exited ${code}: ${stderr || stdout}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

async function download(url, target, maxBytes = Number.POSITIVE_INFINITY) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(new Error("Media exceeds the linked-media size limit"));
    callback(null, chunk);
  } });
  await pipeline(response.body, limiter, createWriteStream(target));
}
function parseRemoteMediaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error("Invalid media URL");
    error.statusCode = 400;
    throw error;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const error = new Error("Only http/https URLs are supported");
    error.statusCode = 400;
    throw error;
  }
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(parsed.hostname.toLowerCase())) {
    const error = new Error("Local media URLs are not supported");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

async function ingestMediaToLocalFile({ videoUrl, audioUrl }, workDir) {
  parseRemoteMediaUrl(videoUrl);
  if (audioUrl) parseRemoteMediaUrl(audioUrl);
  const downloadedVideoPath = path.join(workDir, "source-video");
  await download(videoUrl, downloadedVideoPath, MAX_RESOLVE_BYTES);
  let inputPath = downloadedVideoPath;
  if (audioUrl) {
    const audioPath = path.join(workDir, "source-audio");
    const muxedPath = path.join(workDir, "resolved-video.mp4");
    await download(audioUrl, audioPath, MAX_RESOLVE_BYTES);
    await run(FFMPEG_PATH, [
      "-y", "-hide_banner",
      "-i", downloadedVideoPath,
      "-i", audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c", "copy",
      "-shortest",
      muxedPath,
    ]);
    inputPath = muxedPath;
  }
  const metadata = await probeVideo(inputPath);
  if (!metadata.duration || metadata.duration <= 0) throw new Error("Unable to determine resolved video duration");
  if (metadata.duration > MAX_RESOLVE_SECONDS) {
    const error = new Error(`Resolved video is too long (${metadata.duration.toFixed(1)}s). Max: ${MAX_RESOLVE_SECONDS}s`);
    error.statusCode = 400;
    throw error;
  }
  return { inputPath, metadata };
}

async function probeVideo(inputPath) {
  const { stdout } = await run(FFPROBE_PATH, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video") || {};
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration || video.duration || 0);
  const fpsParts = String(video.avg_frame_rate || video.r_frame_rate || "0/1").split("/").map(Number);
  const fps = fpsParts[1] ? fpsParts[0] / fpsParts[1] : fpsParts[0] || undefined;
  return {
    duration,
    width: Number(video.width || 0) || undefined,
    height: Number(video.height || 0) || undefined,
    fps,
    hasAudio: Boolean(audio),
  };
}

async function detectSceneCuts(inputPath) {
  try {
    const { stderr } = await run(FFMPEG_PATH, [
      "-hide_banner",
      "-i", inputPath,
      "-filter:v", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      "-f", "null",
      "-",
    ]);
    const cuts = [];
    const pattern = /pts_time:([0-9.]+)/g;
    let match;
    while ((match = pattern.exec(stderr))) {
      const seconds = Number(match[1]);
      if (Number.isFinite(seconds) && seconds > MIN_SCENE_SECONDS) cuts.push(seconds);
    }
    return [...new Set(cuts.map((value) => Number(value.toFixed(3))))].sort((a, b) => a - b);
  } catch (error) {
    console.warn("Scene detection failed, using duration fallback:", error.message);
    return [];
  }
}

function parsePySceneDetectCuts(payload, duration) {
  const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
  return scenes
    .map((scene) => Number(scene.start))
    .filter((seconds) => Number.isFinite(seconds) && seconds > MIN_SCENE_SECONDS && seconds < duration - MIN_SCENE_SECONDS)
    .map((seconds) => Number(seconds.toFixed(3)));
}

async function detectSceneCutsWithPySceneDetect(inputPath, metadata) {
  if (!PYSCENEDETECT_ENABLED) return null;
  try {
    const { stdout } = await run(PYTHON_PATH, [
      PYSCENEDETECT_SCRIPT_PATH,
      "--input", inputPath,
      "--detector", PYSCENEDETECT_DETECTOR,
      "--threshold", String(PYSCENEDETECT_THRESHOLD),
      "--adaptive-threshold", String(PYSCENEDETECT_ADAPTIVE_THRESHOLD),
      "--min-scene-seconds", String(MIN_SCENE_SECONDS),
      "--fps", String(metadata.fps || 30),
    ]);
    const payload = JSON.parse(stdout);
    const cuts = parsePySceneDetectCuts(payload, metadata.duration);
    return {
      provider: "pyscenedetect",
      detector: payload.detector || PYSCENEDETECT_DETECTOR,
      cuts: [...new Set(cuts)].sort((a, b) => a - b),
      rawSceneCount: Array.isArray(payload.scenes) ? payload.scenes.length : 0,
    };
  } catch (error) {
    console.warn("PySceneDetect failed, falling back to FFmpeg scene detection:", error.message);
    return null;
  }
}

async function detectSceneCutsWithFallback(inputPath, metadata) {
  const pySceneDetectResult = await detectSceneCutsWithPySceneDetect(inputPath, metadata);
  if (pySceneDetectResult) return pySceneDetectResult;
  return {
    provider: "ffmpeg_scene_filter",
    detector: "scene",
    cuts: await detectSceneCuts(inputPath),
    rawSceneCount: undefined,
  };
}

function buildBoundaries(cuts, duration) {
  const raw = [0, ...cuts.filter((cut) => cut > MIN_SCENE_SECONDS && cut < duration - MIN_SCENE_SECONDS), duration];
  const normalized = [];
  for (let index = 0; index < raw.length - 1; index += 1) {
    const start = raw[index];
    const end = raw[index + 1];
    if (end - start < MIN_SCENE_SECONDS && normalized.length) {
      normalized[normalized.length - 1].end = end;
      continue;
    }
    normalized.push({ start, end });
  }

  const expanded = [];
  normalized.forEach((scene, sceneIndex) => {
    const durationSeconds = scene.end - scene.start;
    const shotGroupId = `shot-${String(sceneIndex + 1).padStart(3, "0")}`;
    if (durationSeconds <= MAX_SCENE_SECONDS) {
      expanded.push({ ...scene, shotGroupId });
      return;
    }
    let cursor = scene.start;
    let segmentIndex = 0;
    while (cursor < scene.end - 0.05) {
      const end = Math.min(cursor + MAX_SCENE_SECONDS, scene.end);
      expanded.push({ start: cursor, end, shotGroupId: `${shotGroupId}.${String(segmentIndex + 1).padStart(2, "0")}` });
      cursor = end;
      segmentIndex += 1;
    }
  });
  return expanded;
}

async function uploadFile(localPath, key, contentType) {
  const body = await readFile(localPath);
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function extractSceneAssets(inputPath, workDir, projectKey, boundaries, metadata, exact = false) {
  const scenes = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const item = boundaries[index];
    const sceneIndex = index + 1;
    const start = Number(item.start.toFixed(3));
    const end = Number(item.end.toFixed(3));
    const duration = Number((end - start).toFixed(3));
    const scenePrefix = `${projectKey}/scenes/${String(sceneIndex).padStart(3, "0")}`;
    const clipPath = path.join(workDir, `scene-${sceneIndex}.mp4`);
    const framePath = path.join(workDir, `scene-${sceneIndex}-keyframe.jpg`);
    const audioPath = path.join(workDir, `scene-${sceneIndex}.m4a`);

    await run(FFMPEG_PATH, [
      "-y", "-hide_banner",
      "-ss", String(start),
      "-i", inputPath,
      "-t", String(duration),
      ...(exact ? ["-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac"] : ["-c", "copy"]),
      "-avoid_negative_ts", "make_zero",
      clipPath,
    ]);

    await run(FFMPEG_PATH, [
      "-y", "-hide_banner",
      "-ss", String(start + Math.max(0.05, duration / 2)),
      "-i", inputPath,
      "-frames:v", "1",
      "-q:v", "2",
      framePath,
    ]);

    let audioUrl;
    if (metadata.hasAudio) {
      try {
        await run(FFMPEG_PATH, [
          "-y", "-hide_banner",
          "-ss", String(start),
          "-i", inputPath,
          "-t", String(duration),
          "-vn",
          "-c:a", "aac",
          audioPath,
        ]);
        const audioStat = await stat(audioPath).catch(() => null);
        if (audioStat?.size) audioUrl = await uploadFile(audioPath, `${scenePrefix}/audio.m4a`, "audio/mp4");
      } catch (error) {
        console.warn(`Audio extraction failed for scene ${sceneIndex}:`, error.message);
      }
    }

    const clipUrl = await uploadFile(clipPath, `${scenePrefix}/clip.mp4`, "video/mp4");
    const keyframeUrl = await uploadFile(framePath, `${scenePrefix}/keyframe.jpg`, "image/jpeg");

    scenes.push({
      sceneIndex,
      startTime: start,
      endTime: end,
      duration,
      shotGroupId: item.shotGroupId,
      clipUrl,
      keyframeUrls: [keyframeUrl],
      audioUrl,
      transitionIn: sceneIndex === 1 ? "start" : "hard_cut",
      transitionOut: sceneIndex === boundaries.length ? "end" : "hard_cut",
    });
  }
  return scenes;
}

async function extractAudioPreviewAsset(inputPath, workDir, projectKey, metadata) {
  if (!metadata.hasAudio) return undefined;
  const duration = Math.min(MUSIC_RECOGNITION_PREVIEW_SECONDS, Math.max(0.1, metadata.duration || MUSIC_RECOGNITION_PREVIEW_SECONDS));
  const audioPath = path.join(workDir, "music-recognition-preview.m4a");
  try {
    await run(FFMPEG_PATH, [
      "-y", "-hide_banner",
      "-ss", "0",
      "-i", inputPath,
      "-t", String(duration),
      "-vn",
      "-c:a", "aac",
      audioPath,
    ]);
    const audioStat = await stat(audioPath).catch(() => null);
    if (!audioStat?.size) return undefined;
    const audioUrl = await uploadFile(audioPath, `${projectKey}/audio/music-recognition-preview.m4a`, "audio/mp4");
    return { audioUrl, duration };
  } catch (error) {
    console.warn("Music recognition audio preview extraction failed:", error.message);
    return undefined;
  }
}

async function handleIngestMedia(req, res) {
  assertAuth(req);
  requireEnv();
  const body = await readJson(req);
  const supportedPlatforms = ["youtube", "tiktok", "douyin", "x", "bilibili"];
  if (!body.videoUrl || typeof body.videoUrl !== "string") {
    return json(res, 400, { error: "Missing videoUrl" });
  }
  if (!supportedPlatforms.includes(body.platform)) {
    return json(res, 400, { error: "Unsupported platform" });
  }
  if (body.audioUrl !== undefined && typeof body.audioUrl !== "string") {
    return json(res, 400, { error: "Invalid audioUrl" });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "prompt-lens-resolve-"));
  try {
    await mkdir(workDir, { recursive: true });
    const { inputPath, metadata } = await ingestMediaToLocalFile(body, workDir);
    const key = `linked-media/${body.platform}/${randomUUID()}.mp4`;
    const mediaUrl = await uploadFile(inputPath, key, "video/mp4");
    return json(res, 200, {
      mediaUrl,
      storageKey: key,
      mediaType: "video",
      platform: body.platform,
      metadata,
      filename: typeof body.filename === "string" ? body.filename : `${body.platform}-linked-video.mp4`,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
async function handleBreakdown(req, res) {
  assertAuth(req);
  requireEnv();
  const body = await readJson(req);
  if (!body.videoUrl || typeof body.videoUrl !== "string") {
    return json(res, 400, { error: "Missing videoUrl" });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "prompt-lens-"));
  try {
    await mkdir(workDir, { recursive: true });
    const inputPath = path.join(workDir, "input-video");
    await download(body.videoUrl, inputPath);
    const metadata = await probeVideo(inputPath);
    if (!metadata.duration || metadata.duration <= 0) throw new Error("Unable to determine video duration");
    const sceneDetection = await detectSceneCutsWithFallback(inputPath, metadata);
    const boundaries = buildBoundaries(sceneDetection.cuts, metadata.duration);
    const projectKey = `workflow/${randomUUID()}`;
    const audioPreview = await extractAudioPreviewAsset(inputPath, workDir, projectKey, metadata);
    const scenes = await extractSceneAssets(inputPath, workDir, projectKey, boundaries, metadata);
    return json(res, 200, { metadata: { ...metadata, sceneDetection, audioPreviewUrl: audioPreview?.audioUrl, audioPreviewDuration: audioPreview?.duration }, scenes });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

let commercialRequests = 0;
async function handleCommercialMedia(req, res) {
  assertAuth(req);
  requireEnv();
  if (commercialRequests >= 2) return json(res, 429, { error: "Media worker busy" });
  const body = await readJson(req);
  const url = new URL(body.videoUrl);
  const allowedHosts = [R2_PUBLIC_URL, R2_ENDPOINT].filter(Boolean).map((value) => new URL(value).hostname);
  if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname)) return json(res, 400, { error: "Only configured storage is supported" });
  if (!["preview", "assets"].includes(body.mode)) return json(res, 400, { error: "Invalid media operation" });
  commercialRequests++;
  let workDir;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), "prompt-lens-commercial-"));
    const inputPath = path.join(workDir, "input.mp4");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error("Media download failed");
    let bytes = 0;
    const hash = createHash("sha256");
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > 100 * 1024 * 1024) return callback(new Error("Media exceeds 100MB"));
      hash.update(chunk); callback(null, chunk);
    } });
    await pipeline(response.body, limiter, createWriteStream(inputPath));
    const sourceHash = hash.digest("hex");
    const metadata = await probeVideo(inputPath);
    const durationUs = Math.round(metadata.duration * 1000000);
    if (!metadata.width || !Number.isSafeInteger(durationUs) || durationUs <= 0 || durationUs > 60000000) throw new Error("Video must be between 0 and 60 seconds");
    if (body.mode === "preview") {
      const detection = body.automaticSplit === true ? await detectSceneCutsWithFallback(inputPath, metadata) : { cuts: [] };
      // Real detected shots, without the legacy worker's arbitrary eight-second chunks.
      const cuts = [0, ...new Set(detection.cuts.map((n) => Math.round(n * 1000000)).filter((n) => n > 0 && n < durationUs)), durationUs].sort((a, b) => a - b);
      if (cuts.length > 21) throw new Error("Video exceeds 20 detected shots");
      const scenes = cuts.slice(0, -1).map((startUs, index) => ({ id: String(index + 1), startUs, endUs: cuts[index + 1] }));
      return json(res, 200, { sourceHash, durationUs, bytes, metadata, scenes });
    }
    if (body.sourceHash !== sourceHash) throw new Error("Source changed after quote");
    if (!Array.isArray(body.scenes) || !body.scenes.length || body.scenes.length > 20) throw new Error("Invalid scene selection");
    let end = 0;
    const boundaries = body.scenes.map((scene) => {
      if (!Number.isSafeInteger(scene.startUs) || !Number.isSafeInteger(scene.endUs) || scene.startUs < end || scene.endUs <= scene.startUs || scene.endUs > durationUs) throw new Error("Invalid scene interval");
      end = scene.endUs;
      return { start: scene.startUs / 1000000, end: scene.endUs / 1000000, shotGroupId: scene.id };
    });
    const scenes = await extractSceneAssets(inputPath, workDir, `workflow/${randomUUID()}`, boundaries, metadata, true);
    return json(res, 200, { metadata, scenes });
  } finally {
    commercialRequests--;
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return json(res, 200, { ok: true });
    if (req.method === "POST" && req.url === "/ingest-media") return await handleIngestMedia(req, res);
    if (req.method === "POST" && req.url === "/breakdown") return await handleBreakdown(req, res);
    if (req.method === "POST" && req.url === "/commercial-media") return await handleCommercialMedia(req, res);
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(error);
    return json(res, status, { error: error.message || "Worker error" });
  }
});

server.listen(PORT, () => {
  console.log(`Prompt Lens FFmpeg worker listening on ${PORT}`);
});

// Optional single-flight scheduler. Deployment must provide a dedicated cron secret.
const reconciliationBase = process.env.COMMERCIAL_RECONCILIATION_BASE_URL;
const reconciliationSecret = process.env.CRON_SECRET;
if (reconciliationBase && reconciliationSecret) {
  const endpoint = new URL("/api/cron/commercial-reconciliation", reconciliationBase);
  if (endpoint.protocol !== "https:") throw new Error("Commercial reconciliation requires HTTPS");
  const tick = async () => {
    try {
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${reconciliationSecret}` }, signal: AbortSignal.timeout(290000), redirect: "error" });
      if (!response.ok) console.warn("Commercial reconciliation unavailable:", response.status);
    } catch { console.warn("Commercial reconciliation request unconfirmed"); }
    setTimeout(tick, 60000).unref();
  };
  setTimeout(tick, 1000).unref();
}
