import { afterEach, expect, it, vi } from "vitest";
import { buildInfistarVideoPayload, createInfistarVideo, getInfistarVideoStatus } from "@/lib/ai/adapters/infistar-video";
import { generationChoices, resolveGenerationModel } from "@/lib/ai/generation-models";

vi.mock("@/lib/cloudflare/r2", () => ({ uploadToR2: vi.fn() }));
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

it("sends authorized MiniMax video references as binary multipart files", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "MiniMax-H3" }] })).mockResolvedValueOnce(Response.json({ id: "reference-task" }));
  vi.stubGlobal("fetch", fetcher);
  expect(await createInfistarVideo({ model: "MiniMax-H3", prompt: "Change the cube to blue", duration: 5, resolution: "1080p", referenceVideoUrl: "https://media.example/source.mp4" }, "minimax-reference-fixture", { userId: "owner" })).toMatchObject({ taskId: "reference-task" });
  const request = fetcher.mock.calls[1][1];
  expect(request.body).toBeInstanceOf(FormData);
  expect(request.body.get("input_reference")).toBeInstanceOf(Blob);
  expect(request.body.get("model")).toBe("MiniMax-H3");
  expect(request.headers["Content-Type"]).toBeUndefined();
});
