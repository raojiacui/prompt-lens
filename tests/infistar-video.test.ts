import { afterEach, expect, it, vi } from "vitest";
import { buildInfistarVideoPayload, createInfistarVideo, getInfistarVideoStatus } from "@/lib/ai/adapters/infistar-video";
import { generationChoices, generationDisplayName, resolveGenerationModel } from "@/lib/ai/generation-models";

const storage = vi.hoisted(() => ({ cleanup: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { insert: () => ({ values: storage.cleanup }) } }));
vi.mock("@/lib/cloudflare/r2", () => ({ uploadToR2: storage.upload }));
vi.mock("@/lib/ai/reference-media-access", () => ({ assertReferenceMediaAccess: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/infistar-media", () => ({ readInfistarMedia: vi.fn(async () => new Blob(["fixture-media"], { type: "video/mp4" })) }));
afterEach(() => vi.unstubAllGlobals());
it("returns a failed task with an error as a terminal status without resubmitting", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "failed-task", status: "failed", error: { message: "private upstream details" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getInfistarVideoStatus("failed-task", "fixture")).toMatchObject({ state: "fail", taskId: "failed-task" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});
it("does not mistake an API error or a different task for a failed generation", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "denied" } }))
    .mockResolvedValueOnce(Response.json({ id: "another-task", status: "failed", error: { message: "denied" } }))
    .mockResolvedValueOnce(Response.json({ id: "failed-task", status: "failed", error: {} }, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 3; i++) await expect(getInfistarVideoStatus("failed-task", "fixture")).rejects.toThrow("Infistar 请求失败");
});
it("keeps KIE models and Infistar models separate", () => {
  expect(generationChoices().every(model => model.provider === "kie")).toBe(true);
  expect(generationChoices("infistar").map(model => model.providerModelId)).toContain("kling-video-o1");
  expect(generationChoices("infistar").every(model => model.provider === "infistar")).toBe(true);
});
it("keeps Infistar Doubao Seedance separate from Jimeng Video 3.0, matching the official model square", () => {
  const models = generationChoices("infistar");
  const expected = [
    ["doubao-seedance-2-0-260128", "豆包 Seedance 2.0", "Doubao Seedance"],
    ["doubao-seedance-2-0-fast-260128", "豆包 Seedance 2.0 Fast", "Doubao Seedance"],
    ["doubao-seedance-2.0-mini", "豆包 Seedance 2.0 Mini", "Doubao Seedance"],
    ["jimeng-video-3.0", "即梦 视频 3.0", "Jimeng"],
    ["jimeng-video-3.0-pro", "即梦 视频 3.0 Pro", "Jimeng"],
  ] as const;
  for (const [modelId, displayName, family] of expected) {
    const entry = models.find(m => m.providerModelId === modelId);
    expect(entry, modelId).toBeDefined();
    expect(entry?.displayName).toBe(displayName);
    expect(entry?.family).toBe(family);
    expect(generationDisplayName(modelId)).toBe(displayName);
  }
  expect(models.filter(m => m.family === "Jimeng").every(m => m.providerModelId.startsWith("jimeng-"))).toBe(true);
  expect(models.filter(m => m.family === "Doubao Seedance").every(m => m.providerModelId.startsWith("doubao-seedance-"))).toBe(true);
});

it("builds the exact accepted Seedance Mini request", () => {
  expect(buildInfistarVideoPayload({ model: "doubao-seedance-2.0-mini", prompt: "A cube", duration: 5, resolution: "720p", aspectRatio: "16:9" }))
    .toEqual({ model: "doubao-seedance-2.0-mini", prompt: "A cube", seconds: "5", size: "1280x720" });
});
it("uses the live-accepted Jimeng Pro profile and excludes unavailable Kling 2.6", () => {
  expect(buildInfistarVideoPayload({ model: "jimeng-video-3.0-pro", prompt: "A cube", duration: 5 })).toMatchObject({ size: "1920x1080" });
  expect(() => buildInfistarVideoPayload({ model: "jimeng-video-3.0-pro", prompt: "A cube", duration: 5, resolution: "720p" })).toThrow("画质");
  expect(generationChoices("infistar").map(model => model.providerModelId)).not.toContain("kling-v2-6");
});
it("preserves image input and portrait dimensions for a remaining model", () => {
  expect(buildInfistarVideoPayload({ model: "doubao-seedance-2.0-mini", prompt: "A cube", duration: 5, aspectRatio: "9:16", imageUrls: ["https://media.example/image.png"] }))
    .toMatchObject({ input_reference: "https://media.example/image.png", size: "720x1280" });
});
it("rejects unverified reference video parameters before any paid request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(createInfistarVideo({ model: "doubao-seedance-2.0-mini", prompt: "Edit", referenceVideoUrl: "https://media.example/video.mp4" }, "test-fixture")).rejects.toMatchObject({ outcome: "not_sent" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("normalizes the asynchronous result and never resubmits while polling", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "task-1", status: "completed", metadata: { url: "https://media.example/result.mp4" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getInfistarVideoStatus("task-1", "poll-only-fixture")).toMatchObject({ taskId: "task-1", state: "success", videoUrl: "https://media.example/result.mp4" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});
it("reads the live Kling and Jimeng completed data-array response", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "array-task", status: "completed", object: "video.generation", data: [{ url: "https://media.example/kling.mp4" }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getInfistarVideoStatus("array-task", "array-fixture")).toMatchObject({ state: "success", videoUrl: "https://media.example/kling.mp4" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("removes unverified Wan 2.7 and MiniMax H3 options from Infistar and rejects retired submissions", async () => {
  const retired = ["wan2.7-t2v", "wan2.7-i2v", "MiniMax-H3"];
  const listed = generationChoices("infistar").map(model => model.providerModelId);
  for (const id of retired) {
    expect(listed).not.toContain(id);
    expect(() => resolveGenerationModel(id, { hasImages: false, hasVideo: false })).toThrow("MODEL_UNAVAILABLE");
    expect(() => buildInfistarVideoPayload({ model: id, prompt: "A cube", duration: 5 })).toThrow("请选择 Infistar 支持的视频模型");
  }
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(createInfistarVideo({ model: "MiniMax-H3", prompt: "Edit source video", referenceVideoUrl: "https://media.example/source.mp4" }, "fixture", { userId: "owner" }))
    .rejects.toMatchObject({ outcome: "not_sent" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("registers cleanup before persisting authenticated-only video content", async () => {
  storage.cleanup.mockResolvedValue(undefined);
  storage.upload.mockResolvedValue("https://media.example/persisted.mp4");
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: "content-task", status: "completed" }))
    .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2]), { headers: { "Content-Type": "video/mp4", "Content-Length": "3" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getInfistarVideoStatus("content-task", "content-fixture")).toMatchObject({ state: "success", videoUrl: "https://media.example/persisted.mp4" });
  expect(storage.cleanup).toHaveBeenCalledWith(expect.objectContaining({ storageKey: expect.stringMatching(/^generated\/infistar\//), nextAttemptAt: expect.any(Date) }));
  expect(storage.cleanup.mock.invocationCallOrder.at(-1)).toBeLessThan(storage.upload.mock.invocationCallOrder.at(-1)!);
});
