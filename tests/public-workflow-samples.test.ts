import { expect, it } from "vitest";
import { getPublicSampleBundle, getPublicWorkflowSamples, hasPublicSampleMedia } from "@/lib/samples/public-workflow-samples";

const id = "e3a4aa5b-976d-4dd7-a906-c818f55c4a54";
const mountainSampleId = "52457e72-44d6-41e1-ae89-8233ef50082c";
it("publishes the seven-scene mountain video under its chosen title", async () => {
  const bundle = (await getPublicSampleBundle(mountainSampleId))!;
  expect(bundle.project.title).toBe("风在耳边呼啸，山在脚下臣服");
  expect(bundle.scenes).toHaveLength(7);
  expect(bundle.sceneVersions).toHaveLength(7);
  expect(bundle.scenes.every(scene => scene.status === "completed")).toBe(true);
  expect(bundle.sceneVersions.every(scene => scene.metadata.analysisProvider === "kie" && scene.generationPrompt.trim().length > 0)).toBe(true);
  expect(JSON.stringify(bundle)).not.toMatch(/"(?:userId|analysisTaskId|keyFingerprint|executionId|storageKey|sourceHash)"/);
  expect((await getPublicWorkflowSamples()).find(sample => sample.id === mountainSampleId)?.title).toBe(bundle.project.title);
  expect(hasPublicSampleMedia(bundle.referenceVideos[0].sourceUrl)).toBe(true);
  for (const scene of bundle.scenes) {
    expect(hasPublicSampleMedia(scene.clipUrl!)).toBe(true);
    for (const url of scene.keyframeUrls) expect(hasPublicSampleMedia(url)).toBe(true);
  }
});
it("publishes all eleven real analysis results without private account or execution data", async () => {
  const bundle = (await getPublicSampleBundle(id))!;
  expect(bundle.scenes).toHaveLength(11);
  expect(bundle.sceneVersions).toHaveLength(11);
  expect(bundle.scenes.every(scene => scene.status === "completed")).toBe(true);
  expect(bundle.sceneVersions.every(scene => scene.metadata.analysisProvider === "kie" && scene.generationPrompt.trim().length > 0)).toBe(true);
  expect(JSON.stringify(bundle)).not.toMatch(/userId|analysisTaskId|keyFingerprint|executionId|diagnostic/);
  expect((await getPublicWorkflowSamples()).find(sample => sample.id === id)?.sceneCount).toBe(11);
});
it("protects source, clips and frames referenced by the public snapshot", async () => {
  const bundle = (await getPublicSampleBundle(id))!;
  expect(hasPublicSampleMedia(bundle.referenceVideos[0].sourceUrl)).toBe(true);
  for (const scene of bundle.scenes) {
    expect(hasPublicSampleMedia(scene.clipUrl!)).toBe(true);
    for (const url of scene.keyframeUrls) expect(hasPublicSampleMedia(url)).toBe(true);
  }
  expect(hasPublicSampleMedia("https://example.com/private.mp4")).toBe(false);
});
