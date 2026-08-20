import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { editVideo, getVideoInfo, type EditInstruction } from "@/lib/video-processor/editor";
import type { EditOperation, EditPlan } from "@/lib/workflow/video-editing";

export interface SceneTiming {
  id: string;
  sceneIndex: number;
  startTime: number;
  endTime: number;
}

export interface LocalStandardEditInput {
  sourceVideoUrl: string;
  accessibleVideoUrl: string;
  plan: EditPlan;
  userId: string;
  scenes: SceneTiming[];
}

function positiveRange(start: number, end: number) {
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { startTime: start, endTime: end } : null;
}

function concatSegments(operation: EditOperation) {
  return operation.type === "concat"
    ? operation.segments.map((segment) => positiveRange(segment.start, segment.end)).filter((segment): segment is { startTime: number; endTime: number } => Boolean(segment))
    : [];
}

function deletedSceneSegments(operation: EditOperation, scenes: SceneTiming[], duration: number) {
  if (operation.type !== "delete") return [];
  const target = scenes.find((scene) => scene.id === operation.sceneId || scene.sceneIndex === operation.sceneIndex);
  if (!target) return [];
  return [positiveRange(0, target.startTime), positiveRange(target.endTime, duration)].filter((segment): segment is { startTime: number; endTime: number } => Boolean(segment));
}

export function buildLocalEditInstruction(plan: EditPlan, scenes: SceneTiming[], duration: number): EditInstruction {
  const concat = plan.operations.flatMap(concatSegments);
  const deleteSegments = plan.operations.flatMap((operation) => deletedSceneSegments(operation, scenes, duration));
  const trim = plan.operations.find((operation) => operation.type === "trim");
  const volume = plan.operations.find((operation) => operation.type === "volume" && operation.track === "bgm");

  const trimSegment = trim?.type === "trim"
    ? positiveRange(trim.start ?? 0, trim.end ?? Math.max(0.5, duration + (trim.endOffset ?? 0)))
    : null;

  const segments = concat.length || deleteSegments.length || trimSegment
    ? [...concat, ...deleteSegments, ...(trimSegment ? [trimSegment] : [])]
    : [positiveRange(0, duration)].filter((segment): segment is { startTime: number; endTime: number } => Boolean(segment));

  return {
    segments,
    transitions: segments.length > 1 ? ["fade"] : ["none"],
    transitionDuration: segments.length > 1 ? 0.25 : 0,
    music: volume?.type === "volume" && volume.track === "bgm" ? { volume: volume.value } : undefined,
    colorGrade: "none",
  };
}

async function downloadVideo(url: string, outputPath: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download source video: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

export async function runLocalStandardEdit(input: LocalStandardEditInput) {
  const tempDir = path.join(process.cwd(), "temp_edit", randomUUID());
  await fs.mkdir(tempDir, { recursive: true });
  const sourcePath = path.join(tempDir, "source.mp4");

  try {
    await downloadVideo(input.accessibleVideoUrl || input.sourceVideoUrl, sourcePath);
    const info = await getVideoInfo(sourcePath);
    const instruction = buildLocalEditInstruction(input.plan, input.scenes, info.duration || 1);
    const result = await editVideo(sourcePath, instruction, input.userId, tempDir);
    if (!result.success || !result.outputUrl) throw new Error(result.error || "Local FFmpeg edit failed");
    return { outputUrl: result.outputUrl, instruction };
  } catch (error) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
    throw error;
  }
}