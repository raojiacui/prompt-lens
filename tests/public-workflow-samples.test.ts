import { expect, it } from "vitest";
import { getPublicSampleBundle, getPublicWorkflowSamples, hasPublicSampleMedia } from "@/lib/samples/public-workflow-samples";

const id = "e3a4aa5b-976d-4dd7-a906-c818f55c4a54";
const mountainSampleId = "52457e72-44d6-41e1-ae89-8233ef50082c";
it.each([
  ["5c698174-5a21-48cf-9fe5-93cbe2136280", "圆缺", 10],
  ["da42d280-4d6a-48d6-a7bd-0f1366fb9bb0", "无论我走多远，我永远是我母亲的孩子", 8],
  ["bad27466-22a9-43d8-9f7e-ae0d0182dcac", "西藏人文纪录片", 10],
  ["1a54fb8d-254a-4867-910f-b7d4c6ae8ac0", "山海经", 14],
  ["61998c4e-4df0-405e-8200-d99a1d0d734d", "赛博神祇", 5],
  ["6660cc92-ddcd-4836-921f-d94984eb4eb7", "巨构工业", 5],
] as const)("shows the complete %s sample as %s with %i shots", async (sampleId, title, count) => {
  const bundle = (await getPublicSampleBundle(sampleId))!;
  expect(bundle.project.title).toBe(title);
  expect(bundle.scenes).toHaveLength(count);
  expect(bundle.sceneVersions).toHaveLength(count);
  expect(bundle.scenes.every(scene => scene.status === "completed")).toBe(true);
  expect(bundle.sceneVersions.every(scene => scene.metadata.analysisProvider === "kie" && scene.generationPrompt.trim().length > 0)).toBe(true);
  expect(new Set(bundle.sceneVersions.map(scene => scene.originalSceneId))).toEqual(new Set(bundle.scenes.map(scene => scene.id)));
  expect(JSON.stringify(bundle)).not.toMatch(/"(?:userId|analysisTaskId|keyFingerprint|executionId|storageKey|sourceHash|diagnostic|analysisError)"/);
  expect((await getPublicWorkflowSamples()).find(sample => sample.id === sampleId)).toMatchObject({ title, sceneCount: count });
  expect(hasPublicSampleMedia(bundle.referenceVideos[0].sourceUrl)).toBe(true);
  for (const scene of bundle.scenes) {
    expect(hasPublicSampleMedia(scene.clipUrl!)).toBe(true);
    for (const url of scene.keyframeUrls) expect(hasPublicSampleMedia(url)).toBe(true);
  }
});
it("combines Yuanque's first six and next four shots on one unchanged source timeline", async () => {
  const bundle = (await getPublicSampleBundle("5c698174-5a21-48cf-9fe5-93cbe2136280"))!;
  expect(bundle.scenes.map(scene => scene.sceneIndex)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  expect(bundle.sceneVersions.map(scene => scene.sceneIndex)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  expect(bundle.referenceVideos).toHaveLength(1);
  expect(bundle.scenes[0].startTime).toBe(0);
  expect(bundle.scenes[9].endTime).toBe(24.467);
  for (let i = 1; i < bundle.scenes.length; i++) expect(bundle.scenes[i].startTime).toBe(bundle.scenes[i-1].endTime);
  expect(bundle.scenes.every(scene => scene.projectId === bundle.project.id && scene.referenceVideoId === bundle.referenceVideos[0].id)).toBe(true);
  expect(bundle.sceneVersions.every(scene => scene.projectId === bundle.project.id && scene.projectVersionId === bundle.activeVersion!.id)).toBe(true);
  expect(bundle.scenes.filter(scene => scene.clipUrl?.includes("#t=")).map(scene => scene.sceneIndex)).toEqual([7,8,9,10]);
  expect((await getPublicWorkflowSamples())[0].id).toBe(bundle.project.id);
});
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
