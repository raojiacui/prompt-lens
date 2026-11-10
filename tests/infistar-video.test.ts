import { afterEach, expect, it, vi } from "vitest";
import { buildInfistarVideoPayload, createInfistarVideo, getInfistarVideoStatus } from "@/lib/ai/adapters/infistar-video";
import { generationChoices, resolveGenerationModel } from "@/lib/ai/generation-models";

const storage = vi.hoisted(() => ({ cleanup: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { insert: () => ({ values: storage.cleanup }) } }));
vi.mock("@/lib/cloudflare/r2", () => ({ uploadToR2: storage.upload }));
vi.mock("@/lib/ai/reference-media-access", () => ({ assertReferenceMediaAccess: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/infistar-media", () => ({ readInfistarMedia: vi.fn(async () => new Blob(["fixture-media"], { type: "video/mp4" })) }));
afterEach(() => vi.unstubAllGlobals());
it("keeps KIE models and Infistar models separate", () => {
  expect(generationChoices().every(model => model.provider === "kie")).toBe(true);
  expect(generationChoices("infistar").map(model => model.providerModelId)).toContain("kling-video-o1");
  expect(resolveGenerationModel("wan2.7-t2v", { hasImages: true, hasVideo: false }).providerModelId).toBe("wan2.7-i2v");
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
it("preserves image input and portrait dimensions", () => {
  expect(buildInfistarVideoPayload({ model: "wan2.7-i2v", prompt: "A cube", duration: 5, aspectRatio: "9:16", imageUrls: ["https://media.example/image.png"] }))
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

it("sends authorized MiniMax video references as binary multipart files", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "MiniMax-H3" }] })).mockResolvedValueOnce(Response.json({ id: "reference-task" }));
  vi.stubGlobal("fetch", fetcher);
  expect(await createInfistarVideo({ model: "MiniMax-H3", prompt: "Change the cube to blue", duration: 5, resolution: "2K", referenceVideoUrl: "https://media.example/source.mp4" }, "minimax-reference-fixture", { userId: "owner" })).toMatchObject({ taskId: "reference-task" });
  const request = fetcher.mock.calls[1][1];
  expect(request.body).toBeInstanceOf(FormData);
  expect(request.body.get("input_reference")).toBeInstanceOf(Blob);
  expect(request.body.get("model")).toBe("MiniMax-H3");
  expect(request.body.get("size")).toBe("2K");
  expect(request.headers["Content-Type"]).toBeUndefined();
  expect(() => buildInfistarVideoPayload({ model: "MiniMax-H3", prompt: "Edit", duration: 5, resolution: "2K", aspectRatio: "9:16" })).toThrow("比例");
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
