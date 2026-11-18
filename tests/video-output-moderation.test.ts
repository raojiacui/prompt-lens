import { afterEach, describe, expect, it, vi } from "vitest";
import { moderateVideoOutput, parseVideoOutputVerdict, pollVideoOutputModeration } from "@/lib/safety/video-output-moderation";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const saved = {
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  GOOGLE_VIDEO_MODERATION_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_VIDEO_MODERATION_SERVICE_ACCOUNT_JSON,
  GOOGLE_VIDEO_MODERATION_GCS_BUCKET: process.env.GOOGLE_VIDEO_MODERATION_GCS_BUCKET,
};
const configure = () => {
  process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
  process.env.GOOGLE_VIDEO_MODERATION_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account", client_email: "test@fixture.gserviceaccount.com", private_key: privateKey,
  });
};
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
describe("Google Video Intelligence output moderation", () => {
  it("does not publish until the asynchronous operation completes", () => {
    expect(parseVideoOutputVerdict({ name: "projects/test/locations/us-east1/operations/123", done: false })).toMatchObject({
      state: "checking", operationName: "projects/test/locations/us-east1/operations/123",
    });
    expect(parseVideoOutputVerdict({ done: false }).state).toBe("unavailable");
  });
  it("retains the operation when Google omits done on submission or pending polling", () => {
    const name = "projects/test/locations/us-east1/operations/123";
    expect(parseVideoOutputVerdict({ name })).toEqual({ state: "checking", provider: "google_video_intelligence", operationName: name });
    expect(parseVideoOutputVerdict({ name, metadata: { annotationProgress: [{ progressPercent: 20 }] } }).state).toBe("checking");
  });
  it("fails closed for invalid pending operations and incomplete terminal responses", () => {
    const name = "projects/test/locations/us-east1/operations/123";
    for (const value of [{}, { name: "https://invalid.example/operation" }, { name, done: null }, { name, done: "false" }, { name, response: {} }, { name, done: false, response: {} }]) {
      expect(parseVideoOutputVerdict(value)).toMatchObject({ state: "unavailable", code: "invalid_response" });
    }
    expect(parseVideoOutputVerdict({ name, error: { code: 403 } })).toMatchObject({ state: "unavailable", code: "provider_error" });
  });
  it.each([
    ["VERY_UNLIKELY", "approved"], ["UNLIKELY", "approved"],
    ["POSSIBLE", "review"], ["LIKELY", "blocked"], ["VERY_LIKELY", "blocked"],
    ["LIKELIHOOD_UNSPECIFIED", "review"],
  ])("treats %s as %s", (likelihood, decision) => {
    const data = { done: true, response: { annotationResults: [{ explicitAnnotation: { frames: [{ pornographyLikelihood: likelihood }] } }] } };
    expect(parseVideoOutputVerdict(data).state).toBe(decision);
  });
  it("does not approve errors, empty frames or malformed results", () => {
    expect(parseVideoOutputVerdict(null).state).toBe("unavailable");
    expect(parseVideoOutputVerdict({ done: true, error: { code: 403 } }).state).toBe("unavailable");
    expect(parseVideoOutputVerdict({ done: true, response: { annotationResults: [] } }).state).toBe("unavailable");
    expect(parseVideoOutputVerdict({ done: true, response: { annotationResults: [{ explicitAnnotation: { frames: [] } }] } }).state).toBe("review");
  });
  it("fails closed when Google credentials are unavailable", async () => {
    configure(); delete process.env.GOOGLE_VIDEO_MODERATION_SERVICE_ACCOUNT_JSON;
    const fetcher = vi.fn();
    expect((await moderateVideoOutput("https://video.example/clip.mp4", fetcher)).state).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("polls an existing Google operation, never submitting a duplicate job", async () => {
    configure();
    const fetcher = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture" });
      if (url.endsWith("/operations/123")) return Response.json({
        done: true, name: "projects/test/locations/us-east1/operations/123",
        response: { annotationResults: [{ explicitAnnotation: { frames: [{ pornographyLikelihood: "UNLIKELY" }] } }] },
      });
      throw Error("unexpected URL");
    });
    const result = await pollVideoOutputModeration("projects/test/locations/us-east1/operations/123", fetcher as unknown as typeof fetch);
    expect(result.state).toBe("approved");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps polling the same operation when a pending response omits done", async () => {
    configure();
    const name = "projects/test/locations/us-east1/operations/123";
    let polls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture" });
      if (url === `https://videointelligence.googleapis.com/v1/${name}`) {
        polls++;
        return Response.json(polls === 1 ? { name } : {
          name, done: true,
          response: { annotationResults: [{ explicitAnnotation: { frames: [{ pornographyLikelihood: "UNLIKELY" }] } }] },
        });
      }
      throw Error("unexpected URL");
    });
    expect(await pollVideoOutputModeration(name, fetcher as unknown as typeof fetch)).toMatchObject({ state: "checking", operationName: name });
    expect((await pollVideoOutputModeration(name, fetcher as unknown as typeof fetch)).state).toBe("approved");
    expect(polls).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
