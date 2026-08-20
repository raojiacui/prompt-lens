import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, projectAssets, sceneVersions, workflowJobs } from "@/lib/db";
import { getUserKieApiKey } from "@/lib/byok/kie";
import { uploadToR2 } from "@/lib/cloudflare/r2";
import { parseWorkflowModelSelection } from "@/lib/workflow/model-selection";
import { buildAudioProductionPlan, type AudioProductionScene } from "@/lib/workflow/audio-production";
import { createKieDialogueTask } from "@/lib/workflow/kie-audio";
import { getProjectBundle } from "@/lib/workflow/service";

function recordFromBody(body: unknown) {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = recordFromBody(await request.json().catch(() => null));
  const bundle = await getProjectBundle(id, session.user.id);
  if (!bundle?.activeVersion) return NextResponse.json({ error: "Project not found or has no active version" }, { status: 404 });

  const activeScenes = bundle.sceneVersions.sort((a, b) => a.sceneIndex - b.sceneIndex);
  if (!activeScenes.length) return NextResponse.json({ error: "Project has no scenes for audio production" }, { status: 400 });

  const scenes: AudioProductionScene[] = activeScenes.map((scene) => ({
    id: scene.id,
    sceneIndex: scene.sceneIndex,
    duration: scene.duration,
    blueprint: {
      dialogue: Array.isArray(scene.dialogue) ? scene.dialogue : [],
      narration: Array.isArray(scene.narration) ? scene.narration : [],
      subtitle: Array.isArray(scene.subtitle) ? scene.subtitle : [],
      audio: scene.audio as Record<string, unknown>,
      generationPrompt: scene.generationPrompt,
    },
  }));

  const plan = buildAudioProductionPlan(scenes, parseWorkflowModelSelection(body));
  const srtKey = `projects/${id}/audio/${bundle.activeVersion.id}-subtitles.srt`;
  const srtUrl = await uploadToR2(Buffer.from(plan.srt, "utf8"), srtKey, "application/x-subrip");

  const [asset] = await db.insert(projectAssets).values({
    projectId: id,
    type: "subtitle",
    url: srtUrl,
    storageKey: srtKey,
    fileName: `${bundle.project.title || "project"}-subtitles.srt`,
    mimeType: "application/x-subrip",
    metadata: { versionId: bundle.activeVersion.id, cueCount: plan.subtitles.length, modelId: plan.modelId },
  }).returning();

  for (const scene of activeScenes) {
    const sceneCues = plan.cues.filter((cue) => cue.sceneId === scene.id);
    const sceneSubtitles = plan.subtitles.filter((cue) => cue.sceneId === scene.id);
    await db.update(sceneVersions).set({
      audio: { ...(scene.audio as Record<string, unknown>), production: { modelId: plan.modelId, cues: sceneCues } },
      subtitle: sceneSubtitles,
      metadata: { ...(scene.metadata as Record<string, unknown>), audioProduction: { modelId: plan.modelId, modelMode: plan.modelMode, subtitleAssetId: asset.id } },
      updatedAt: new Date(),
    }).where(and(eq(sceneVersions.id, scene.id), eq(sceneVersions.projectId, id)));
  }

  const apiKey = await getUserKieApiKey(session.user.id) || process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY || null;
  const callbackUrl = typeof body.callbackUrl === "string" ? body.callbackUrl.trim() : undefined;
  let audioTask: Awaited<ReturnType<typeof createKieDialogueTask>> | null = null;
  if (apiKey) {
    audioTask = await createKieDialogueTask({ apiKey, modelId: plan.modelId, cues: plan.cues, callBackUrl: callbackUrl });
  }

  const [job] = await db.insert(workflowJobs).values({
    projectId: id,
    type: "GENERATE_AUDIO",
    status: audioTask ? "processing" : "completed",
    provider: "kie",
    modelId: plan.modelId,
    externalTaskId: audioTask?.taskId,
    resultUrl: audioTask ? null : srtUrl,
    input: { versionId: bundle.activeVersion.id, modelMode: plan.modelMode, modelPriority: plan.modelPriority, callbackUrl },
    output: {
      subtitleAssetId: asset.id,
      subtitleUrl: srtUrl,
      cueCount: plan.cues.length,
      subtitleCount: plan.subtitles.length,
      bgm: plan.bgm,
      sfx: plan.sfx,
      providerTaskId: audioTask?.taskId,
      providerRecordId: audioTask?.recordId,
      ttsStatus: audioTask ? "submitted" : "not_submitted",
      ttsReason: audioTask ? undefined : "KIE API key is not configured; generated subtitle package only.",
    },
    completedAt: audioTask ? null : new Date(),
  }).returning();

  return NextResponse.json({ success: true, plan, subtitleAsset: asset, job, providerTaskId: audioTask?.taskId, providerRecordId: audioTask?.recordId });
}