import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { auth } from "@/lib/auth";
import { db, workflowJobs } from "@/lib/db";
import { extractR2Key, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { createKieVeoGeneration } from "@/lib/reference-video/kie-veo";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
import { buildEditPlan, type EditMode } from "@/lib/workflow/video-editing";
import { getProjectBundle } from "@/lib/workflow/service";

function recordFromBody(body: unknown) {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

async function ensureAccessibleUrl(url: string): Promise<string> {
  const key = extractR2Key(url);
  if (!key) return url;
  return getSignedUrlFromR2(key, 7200).catch(() => url);
}

function bodyString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? String(record[key]).trim() : "";
}

function parseMode(value: unknown): EditMode | "auto" {
  return value === "standard" || value === "generative" ? value : "auto";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = recordFromBody(await request.json().catch(() => null));
  const prompt = bodyString(body, "prompt");
  if (!prompt) return NextResponse.json({ error: "Missing edit prompt" }, { status: 400 });

  const bundle = await getProjectBundle(id, session.user.id);
  if (!bundle?.activeVersion) return NextResponse.json({ error: "Project not found or has no active version" }, { status: 404 });

  const sceneIdsByIndex = Object.fromEntries(bundle.sceneVersions.map((scene) => [scene.sceneIndex, scene.originalSceneId]));
  const sourceVideoUrl = bodyString(body, "sourceVideoUrl") || bundle.sceneVersions.find((scene) => scene.generatedVideoUrl)?.generatedVideoUrl || bundle.referenceVideos[0]?.sourceUrl || "";
  if (!sourceVideoUrl) return NextResponse.json({ error: "No source video is available for editing" }, { status: 400 });

  const plan = buildEditPlan({
    prompt,
    mode: parseMode(body.mode),
    sourceVideoUrl,
    sceneIdsByIndex,
    ...parseWorkflowModelSelection(body),
  });

  if (plan.mode === "generative") {
    const apiKey = await getUserKieApiKey(session.user.id);
    if (!apiKey && !process.env.KIE_AI_API_KEY && !process.env.KIE_API_KEY) {
      return NextResponse.json({ error: "Please add your KIE API Key in Settings before generative video edit." }, { status: 400 });
    }

    const result = await createKieVeoGeneration({
      prompt: plan.prompt,
      model: plan.modelId,
      referenceVideoUrl: sourceVideoUrl,
      generationType: "REFERENCE_2_VIDEO",
    }, apiKey || undefined);

    const [job] = await db.insert(workflowJobs).values({
      projectId: id,
      type: "RENDER_VIDEO",
      status: "processing",
      provider: "kie",
      modelId: plan.modelId,
      externalTaskId: result.taskId,
      input: { sourceVideoUrl, plan },
      output: { providerTaskId: result.taskId },
    }).returning();

    return NextResponse.json({ success: true, plan, job, providerTaskId: result.taskId });
  }

  const ffmpegServiceUrl = (process.env.FFMPEG_WORKER_URL || "").trim();
  const ffmpegWorkerSecret = process.env.FFMPEG_WORKER_SECRET || "";
  if (!ffmpegServiceUrl || !ffmpegWorkerSecret) {
    const [job] = await db.insert(workflowJobs).values({
      projectId: id,
      type: "RENDER_VIDEO",
      status: "failed",
      provider: "ffmpeg",
      error: "FFmpeg worker is not configured on the server",
      input: { sourceVideoUrl, plan },
    }).returning();
    return NextResponse.json({ error: "FFmpeg worker is not configured on the server", plan, job }, { status: 500 });
  }

  const accessibleVideoUrl = await ensureAccessibleUrl(sourceVideoUrl);
  const ffmpegResponse = await axios.post(
    `${ffmpegServiceUrl.replace(/\/$/, "")}/edit`,
    { videoUrl: accessibleVideoUrl, instruction: plan },
    { timeout: 300000, headers: { Authorization: `Bearer ${ffmpegWorkerSecret}` } },
  );
  const outputUrl = typeof ffmpegResponse.data?.url === "string" ? ffmpegResponse.data.url : ffmpegResponse.data?.outputUrl;
  if (!outputUrl) throw new Error("FFmpeg worker did not return an output URL");

  const [job] = await db.insert(workflowJobs).values({
    projectId: id,
    type: "RENDER_VIDEO",
    status: "completed",
    provider: "ffmpeg",
    resultUrl: outputUrl,
    input: { sourceVideoUrl, plan },
    output: { outputUrl },
    completedAt: new Date(),
  }).returning();

  return NextResponse.json({ success: true, plan, outputUrl, job });
}