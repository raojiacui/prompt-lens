import { afterEach, describe, expect, it, vi } from "vitest";
import { createKieVeoGeneration, getKieVeoGenerationStatus } from "@/lib/reference-video/kie-veo";
afterEach(() => vi.unstubAllGlobals());
describe("Seedance 2.5 through the existing KIE transport", () => {
  it("sends the complete 30-second request and polls the returned task without another submit", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 200, data: { taskId: "seedance-long-task" } }))
      .mockResolvedValueOnce(Response.json({ code: 200, data: { taskId: "seedance-long-task", state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.com/long.mp4"] }) } }));
    vi.stubGlobal("fetch", transport);
    const generated = await createKieVeoGeneration({ model: "bytedance/seedance-2-5", prompt: "A complete multi-shot story", duration: 30, resolution: "720p", aspectRatio: "9:16", generateAudio: true }, "own-test-key");
    expect(generated.taskId).toBe("seedance-long-task");
    expect(transport.mock.calls[0][0]).toMatch(/\/api\/v1\/jobs\/createTask$/);
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ model: "bytedance/seedance-2-5", input: { prompt: "A complete multi-shot story", resolution: "720p", nsfw_checker: true, duration: 30, aspect_ratio: "9:16", generate_audio: true, output_format: "mp4" } });
    const status = await getKieVeoGenerationStatus(generated.taskId, "bytedance/seedance-2-5", "own-test-key");
    expect(status).toMatchObject({ state: "success", videoUrl: "https://example.com/long.mp4" });
    expect(String(transport.mock.calls[1][0])).toContain("/api/v1/jobs/recordInfo?taskId=seedance-long-task");
    expect(transport.mock.calls[1][1].headers.Authorization).toBe("Bearer own-test-key");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("treats an HTTP 200 envelope with exhausted credit as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 433, msg: "insufficient credits" })));
    await expect(createKieVeoGeneration({ model: "bytedance/seedance-2-5", prompt: "A long story", duration: 30, resolution: "720p" }, "own-test-key")).rejects.toMatchObject({ kind: "quota_exceeded" });
  });
});
