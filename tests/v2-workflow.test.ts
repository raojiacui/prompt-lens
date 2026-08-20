import { describe, expect, it, vi } from "vitest";
import { buildFallbackSceneBlueprint, remixSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { routeModel } from "@/lib/ai/model-registry";
import { buildAudioProductionPlan } from "@/lib/workflow/audio-production";
import { buildEditPlan } from "@/lib/workflow/video-editing";
import { createKieDialogueTask } from "@/lib/workflow/kie-audio";
import { buildLocalEditInstruction } from "@/lib/workflow/local-standard-edit";

const scene = {
  sceneIndex: 2,
  startTime: 4,
  endTime: 9.5,
  duration: 5.5,
  shotGroupId: "shot-002",
  clipUrl: "https://example.com/scene.mp4",
  keyframeUrls: ["https://example.com/keyframe.jpg"],
  audioUrl: "https://example.com/audio.m4a",
  transitionIn: "hard_cut",
  transitionOut: "hard_cut",
};

describe("V2 scene analysis", () => {
  it("builds an editable fallback blueprint with timing and metadata", () => {
    const blueprint = buildFallbackSceneBlueprint(scene, "no provider configured");

    expect(blueprint.story.summary).toContain("Scene 02");
    expect(blueprint.generationPrompt).toContain("4.0s-9.5s");
    expect(blueprint.transition.in).toBe("hard_cut");
    expect(blueprint.metadata?.analysisProvider).toBe("fallback");
    expect(blueprint.metadata?.fallbackReason).toBe("no provider configured");
  });

  it("creates a deterministic remix fallback when no KIE key exists", async () => {
    const base = buildFallbackSceneBlueprint(scene);
    const remixed = await remixSceneBlueprint({
      userId: "00000000-0000-0000-0000-000000000001",
      scene: base,
      remixPrompt: "turn the lead into a campus comedy character",
      sceneIndex: 2,
      duration: 5.5,
    });

    expect(remixed.story.rewriteInstruction).toContain("campus comedy");
    expect(remixed.generationPrompt).toContain("Scene rewrite instruction");
    expect(remixed.generationPrompt).toContain("5.5s");
  });
});

describe("V2 model routing", () => {
  it("routes a balanced video generation model that can generate from text", () => {
    const model = routeModel({ category: "video_generation", requiredCapabilities: ["text"], duration: 8, aspectRatio: "16:9", priority: "balanced" });

    expect(model?.kieModelId).toBeTruthy();
    expect(model?.capabilities).toContain("text");
  });
});

describe("V2 audio production", () => {
  it("builds TTS cues and SRT subtitles from scene blueprint dialogue", () => {
    const blueprint = buildFallbackSceneBlueprint(scene);
    blueprint.dialogue = [{ start: 0.4, end: 2.1, text: "We are late.", speaker: "Lead" }];
    blueprint.subtitle = [{ start: 0.4, end: 2.1, text: "We are late." }];
    blueprint.audio = { music: "light campus comedy rhythm", sfx: [{ at: 1.2, type: "alarm beep" }] };

    const plan = buildAudioProductionPlan([{ id: "scene-02", sceneIndex: 2, duration: 5.5, blueprint }]);

    expect(plan.modelId).toBeTruthy();
    expect(plan.cues[0].speaker).toBe("Lead");
    expect(plan.srt).toContain("00:00:00,400 --> 00:00:02,100");
    expect(plan.bgm.prompt).toContain("campus comedy");
    expect(plan.sfx[0].prompt).toContain("alarm");
  });

  it("submits a KIE dialogue task with text and voice payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: { taskId: "task-audio", recordId: "record-audio" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createKieDialogueTask({
      apiKey: "test-key",
      modelId: "elevenlabs/text-to-dialogue-v3",
      cues: [{ id: "cue-1", sceneId: "scene-1", sceneIndex: 1, kind: "dialogue", start: 0, end: 2, text: "Hello", speaker: "Lead" }],
    });

    expect(result.taskId).toBe("task-audio");
    expect(fetchMock).toHaveBeenCalledWith("https://api.kie.ai/api/v1/jobs/createTask", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      body: expect.stringContaining("elevenlabs/text-to-dialogue-v3"),
    }));
    vi.unstubAllGlobals();
  });
});

describe("V2 AI video editor", () => {
  it("creates a standard edit plan for timeline operations", () => {
    const plan = buildEditPlan({
      prompt: "删除 Scene 04，BGM 小一点，字幕大一点",
      mode: "standard",
      sceneIdsByIndex: { 4: "scene-04" },
    });

    expect(plan.mode).toBe("standard");
    expect(plan.operations).toContainEqual({ type: "delete", sceneIndex: 4, sceneId: "scene-04" });
    expect(plan.operations).toContainEqual({ type: "volume", track: "bgm", value: 0.45 });
    expect(plan.operations).toContainEqual({ type: "subtitle_style", size: "large", position: "bottom" });
  });

  it("converts a scene delete plan to local FFmpeg keep segments", () => {
    const plan = buildEditPlan({
      prompt: "删除 Scene 02",
      mode: "standard",
      sceneIdsByIndex: { 2: "scene-original-02" },
    });

    const instruction = buildLocalEditInstruction(plan, [
      { id: "scene-original-01", sceneIndex: 1, startTime: 0, endTime: 4 },
      { id: "scene-original-02", sceneIndex: 2, startTime: 4, endTime: 7 },
      { id: "scene-original-03", sceneIndex: 3, startTime: 7, endTime: 10 },
    ], 10);

    expect(instruction.segments).toEqual([{ startTime: 0, endTime: 4 }, { startTime: 7, endTime: 10 }]);
  });

  it("routes generative video edits through the video edit registry", () => {
    const plan = buildEditPlan({
      prompt: "把背景换成夜晚，但保留原来的动作",
      mode: "auto",
      sourceVideoUrl: "https://example.com/generated.mp4",
    });

    expect(plan.mode).toBe("generative");
    expect(plan.modelId).toBeTruthy();
    expect(plan.notes[0]).toContain("KIE video edit");
  });
});