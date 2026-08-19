import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.FFMPEG_WORKER_SECRET || "";
const B2_REGION = process.env.B2_REGION;
const R2_ENDPOINT = process.env.R2_ENDPOINT || process.env.B2_ENDPOINT || (B2_REGION ? `https://s3.${B2_REGION}.backblazeb2.com` : undefined);
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.B2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.B2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || process.env.B2_BUCKET_NAME;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.B2_PUBLIC_URL || "").replace(/\/$/, "");
const SCENE_THRESHOLD = process.env.SCENE_THRESHOLD || "0.32";
const MAX_SCENE_SECONDS = Number(process.env.MAX_SCENE_SECONDS || 8);
const MIN_SCENE_SECONDS = Number(process.env.MIN_SCENE_SECONDS || 0.6);
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_PATH = process.env.FFPROBE_PATH || "ffprobe";

function requireEnv() {
  const missing = [
    ["WORKER_SECRET", WORKER_SECRET],
    ["R2_ENDPOINT or B2_REGION", R2_ENDPOINT],
    ["R2_ACCESS_KEY_ID or B2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID],
    ["R2_SECRET_ACCESS_KEY or B2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY],
    ["R2_BUCKET/R2_BUCKET_NAME or B2_BUCKET_NAME", R2_BUCKET],
    ["R2_PUBLIC_URL or B2_PUBLIC_URL", R2_PUBLIC_URL],
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

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  await pipeline(response.body, createWriteStream(target));
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

async function extractSceneAssets(inputPath, workDir, projectKey, boundaries, metadata) {
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
      "-c", "copy",
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
    const cuts = await detectSceneCuts(inputPath);
    const boundaries = buildBoundaries(cuts, metadata.duration);
    const projectKey = `workflow/${randomUUID()}`;
    const scenes = await extractSceneAssets(inputPath, workDir, projectKey, boundaries, metadata);
    return json(res, 200, { metadata, scenes });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return json(res, 200, { ok: true });
    if (req.method === "POST" && req.url === "/breakdown") return await handleBreakdown(req, res);
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
