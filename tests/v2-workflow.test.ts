import { describe, expect, it, vi } from "vitest";
import { buildFallbackSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { routeModel } from "@/lib/ai/model-registry";
import { buildAudioProductionPlan } from "@/lib/workflow/audio-production";
import { buildEditPlan } from "@/lib/workflow/video-editing";
import { createKieDialogueTask } from "@/lib/workflow/kie-audio";
import { buildLocalEditInstruction } from "@/lib/workflow/local-standard-edit";
import { buildSceneAudioContexts } from "@/lib/workflow/transcription";
import { createKieVeoGeneration, KieProviderError } from "@/lib/reference-video/kie-veo";
import { recognizeBackgroundMusic } from "@/lib/workflow/music-recognition";

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
  it("preserves failed scene timing without fabricating a usable prompt", () => {
    const blueprint = buildFallbackSceneBlueprint(scene, "no provider configured", undefined, "en");

    expect(blueprint.story).toMatchObject({ sceneIndex: 2, startTime: 4, endTime: 9.5 });
    expect(blueprint.transition.in).toBe("hard_cut");
    expect(blueprint.visual).toEqual({});
    expect(blueprint.generationPrompt).toBe("");
    expect(blueprint.metadata?.analysisProvider).toBe("fallback");
    expect(blueprint.metadata?.fallbackReason).toBe("no provider configured");
  });


  it("aligns KIE speech-to-text transcript segments to detected scene timestamps", () => {
    const scenes = [
      { ...scene, sceneIndex: 1, startTime: 0, endTime: 3.5, duration: 3.5, shotGroupId: "shot-001" },
      { ...scene, sceneIndex: 2, startTime: 3.5, endTime: 8, duration: 4.5, shotGroupId: "shot-002" },
    ];

    const contexts = buildSceneAudioContexts({
      scenes,
      transcription: {
        provider: "kie",
        modelId: "elevenlabs/speech-to-text",
        taskId: "task-stt",
        status: "completed",
        segments: [
          { start: 0.4, end: 1.2, text: "Wake up!", speaker: "A" },
          { start: 4.1, end: 5.3, text: "We are late.", speaker: "B" },
        ],
      },
    });

    expect(contexts.get(1)?.dialogue).toEqual([{ start: 0.4, end: 1.2, text: "Wake up!", speaker: "A" }]);
    expect(contexts.get(2)?.dialogue[0]).toMatchObject({ start: 0.6, end: 1.8, text: "We are late.", speaker: "B" });
    expect(contexts.get(2)?.audio.transcriptionProvider).toBe("kie");
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

describe("AudD background music recognition", () => {
  it("skips recognition when no AudD token is configured", async () => {
    vi.stubEnv("AUDD_API_TOKEN", "");

    const result = await recognizeBackgroundMusic("https://example.com/preview.m4a");

    expect(result.status).toBe("disabled");
    vi.unstubAllEnvs();
  });

  it("normalizes recognized AudD metadata", async () => {
    vi.stubEnv("AUDD_API_TOKEN", "test-audd-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        result: {
          title: "Midnight City",
          artist: "M83",
          album: "Hurry Up, We're Dreaming",
          song_link: "https://song.link/example",
          apple_music: { url: "https://music.apple.com/example" },
          spotify: { external_urls: { spotify: "https://open.spotify.com/track/example" } },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await recognizeBackgroundMusic("https://example.com/preview.m4a");

    expect(result).toMatchObject({
      status: "recognized",
      title: "Midnight City",
      artist: "M83",
      album: "Hurry Up, We're Dreaming",
      songLink: "https://song.link/example",
      appleMusicUrl: "https://music.apple.com/example",
      spotifyUrl: "https://open.spotify.com/track/example",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.audd.io/", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});


describe("KIE BYOK video generation", () => {
  it("submits generation tasks with the caller supplied KIE API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ code: 200, data: { taskId: "task-video" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createKieVeoGeneration({
      prompt: "Create a short product video",
      model: "wan/2-7-text-to-video",
      duration: 5,
    }, "user-kie-key");

    expect(result.taskId).toBe("task-video");
    expect(fetchMock).toHaveBeenCalledWith("https://api.kie.ai/api/v1/jobs/createTask", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer user-kie-key" }),
    }));
    vi.unstubAllGlobals();
  });

  it("maps KIE point limit failures to a friendly quota error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        code: 433,
        msg: "The current number of points used by apiKey has exceeded the total limit",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createKieVeoGeneration({
      prompt: "Create a short product video",
      model: "wan/2-7-text-to-video",
      duration: 5,
    }, "spent-kie-key")).rejects.toMatchObject({
      name: "KieProviderError",
      code: 433,
      kind: "quota_exceeded",
      status: 402,
    } satisfies Partial<KieProviderError>);

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
