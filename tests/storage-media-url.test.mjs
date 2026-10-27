import { describe, expect, it } from "vitest";
import { configuredStorageMediaUrl } from "../workers/ffmpeg-worker/storage-media-url.mjs";

const storage = { publicUrl: "https://public.example", endpoint: "https://account.r2.cloudflarestorage.com" };
describe("configured worker storage URL boundary", () => {
  it("accepts a signed object URL without changing its signature", () => {
    const signed = `${storage.endpoint}/test-bucket/video.mp4?X-Amz-Signature=test-signature`;
    expect(configuredStorageMediaUrl(signed, storage).href).toBe(signed);
  });
  it.each(["publicUrl", "endpoint"])("names an invalid %s configuration without echoing credentials", (field) => {
    let failure;
    try { configuredStorageMediaUrl(`${storage.publicUrl}/video.mp4`, { ...storage, [field]: "invalid-secret-config" }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "MEDIA_STORAGE_CONFIG_INVALID", statusCode: 503 });
    expect(failure.message).toContain(field === "publicUrl" ? "R2_PUBLIC_URL" : "R2_ENDPOINT");
    expect(failure.message).not.toContain("invalid-secret-config");
  });
  it.each([undefined, "not-a-url", "http://public.example/video", "https://other.example/video", "https://user:pass@public.example/video"])("rejects unsafe video input %s before download", (value) => {
    expect(() => configuredStorageMediaUrl(value, storage)).toThrow();
    try { configuredStorageMediaUrl(value, storage); } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_MEDIA_URL", statusCode: 400 });
    }
  });
});
