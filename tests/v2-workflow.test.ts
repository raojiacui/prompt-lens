import { describe, expect, it } from "vitest";
import { buildFallbackSceneBlueprint, remixSceneBlueprint } from "@/lib/workflow/scene-analysis";
import { routeModel } from "@/lib/ai/model-registry";

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

  it("creates a deterministic remix fallback when no OpenRouter key exists", async () => {
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
