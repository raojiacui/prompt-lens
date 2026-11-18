import { afterEach, describe, expect, it, vi } from "vitest";
import { moderateVideoOutput, parseVideoOutputVerdict } from "@/lib/safety/video-output-moderation";

const original = {
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  SIGHTENGINE_API_USER: process.env.SIGHTENGINE_API_USER,
  SIGHTENGINE_API_SECRET: process.env.SIGHTENGINE_API_SECRET,
  SIGHTENGINE_WORKFLOW_ID: process.env.SIGHTENGINE_WORKFLOW_ID,
};
afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
describe("generated video output moderation", () => {
  it.each([
    ["accept", "approved"], ["review", "review"], ["reject", "blocked"], ["unknown", "unavailable"],
  ])("recognizes explicit workflow verdict %s", (action, expected) => {
    expect(parseVideoOutputVerdict({ status: "success", summary: { action }, request: { id: "req_123" } }).state).toBe(expected);
  });
  it("does not approve invalid or failed provider responses", () => {
    expect(parseVideoOutputVerdict(null).state).toBe("unavailable");
    expect(parseVideoOutputVerdict({ status: "failure", summary: { action: "accept" } }).state).toBe("unavailable");
    expect(parseVideoOutputVerdict({ status: "success" }).state).toBe("unavailable");
  });
  it("fails closed if staging credentials are unavailable", async () => {
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    delete process.env.SIGHTENGINE_API_USER;
    const fetcher = vi.fn();
    const result = await moderateVideoOutput("https://video.example/clip.mp4", fetcher);
    expect(result.code).toBe("not_configured");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("submits the generated video and only approves an explicit accept", async () => {
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    process.env.SIGHTENGINE_API_USER = "test_user";
    process.env.SIGHTENGINE_API_SECRET = "test_secret";
    process.env.SIGHTENGINE_WORKFLOW_ID = "wfl_fixture12345";
    const fetcher = vi.fn(async () => Response.json({ status: "success", summary: { action: "accept" }, request: { id: "req_123" } }));
    const verdict = await moderateVideoOutput("https://video.example/clip.mp4", fetcher);
    expect(verdict).toMatchObject({ state: "approved", requestId: "req_123" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sightengine.com/1.0/video/check-workflow-sync.json");
    expect(request.method).toBe("POST");
    expect((request.body as URLSearchParams).get("stream_url")).toBe("https://video.example/clip.mp4");
    expect((request.body as URLSearchParams).get("workflow")).toBe("wfl_fixture12345");
  });
  it("rejects insecure and local video inputs", async () => {
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    process.env.SIGHTENGINE_API_USER = "test_user";
    process.env.SIGHTENGINE_API_SECRET = "test_secret";
    process.env.SIGHTENGINE_WORKFLOW_ID = "wfl_fixture12345";
    for (const url of ["http://video.example/clip.mp4", "https://localhost/a.mp4", "https://127.0.0.1/a.mp4", "https://user:pass@video.example/a.mp4"]) {
      const fetcher = vi.fn();
      expect((await moderateVideoOutput(url, fetcher)).state).toBe("unavailable");
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});
