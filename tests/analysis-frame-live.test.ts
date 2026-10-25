import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { deleteFromR2, getPresignedUploadUrl, getSignedUrlFromR2 } from "@/lib/cloudflare/r2";
import { prepareAnalysisFrames } from "@/lib/ai/analysis-frame-access";
import { requestKieChatCompletion } from "@/lib/ai/kie-chat-client";
import { getKieAnalysisPath } from "@/lib/ai/analysis-models";

// Opt-in only: uploads one isolated test object and consumes one small KIE call.
// Use a test bucket. Never print the presigned URL or provider key.
describe.runIf(process.env.ANALYSIS_FRAME_LIVE_TEST === "1")("R2 analysis frame delivery", () => {
  it("uploads a JPEG, reads its bytes from the bucket, and lets KIE analyze it", async () => {
    if (!/dev|test/i.test(process.env.R2_BUCKET_NAME || "")) throw new Error("Live smoke test requires a test bucket");
    const require = createRequire(import.meta.url);
    const sharp = createRequire(require.resolve("next/package.json"))("sharp");
    const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#e04020" } }).jpeg().toBuffer();
    const key = `analysis-frames/smoke-test/${crypto.randomUUID()}/frame-01.jpg`;
    try {
      const uploadUrl = await getPresignedUploadUrl(key, "image/jpeg", 600);
      const upload = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: image, signal: AbortSignal.timeout(30_000) });
      expect(upload.status).toBe(200);
      const [inlineFrame] = await prepareAnalysisFrames([key]);
      expect(inlineFrame).toBe(`data:image/jpeg;base64,${image.toString("base64")}`);
      const signedUrl = await getSignedUrlFromR2(key, 900);
      const download = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
      expect(download.status).toBe(200);
      expect(Buffer.from(await download.arrayBuffer()).equals(image)).toBe(true);
      console.log("R2 signed PUT and bounded authenticated GET verified; JPEG bytes match.");
      const apiKey = process.env.KIE_AI_API_KEY || process.env.KIE_API_KEY;
      if (!apiKey) throw new Error("KIE test key is required");
      const model = "gemini-3-8-flash";
      const base = (process.env.KIE_AI_BASE_URL || process.env.KIE_API_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
      const input = process.env.FRAME_TEST_INPUT || "inline";
      const content = input === "text" ? [{ type: "text", text: "Reply with the word OK." }] : [
        { type: "text", text: "Name the dominant color in this image in one short sentence." },
        ...Array.from({ length: Number(process.env.FRAME_TEST_COUNT || "1") }, () => (
          { type: "image_url", image_url: { url: input === "inline" ? inlineFrame : signedUrl } }
        )),
      ];
      const result = await requestKieChatCompletion({
        url: `${base}${getKieAnalysisPath(model)}`,
        apiKey,
        payload: { model, max_tokens: 128, include_thoughts: false, messages: [{ role: "user", content }] },
      });
      expect(result.trim().length).toBeGreaterThan(0);
      console.log("R2 signed PUT/GET and KIE image analysis succeeded (test bucket, synthetic image).");
    } finally {
      await deleteFromR2(key);
    }
  }, 300_000);
});
