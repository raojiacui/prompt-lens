import { getFromR2 } from "@/lib/cloudflare/r2";
import { AnalysisFrameInputError, MAX_ANALYSIS_FRAME_BYTES } from "./analysis-frame-input";

// Read from the upload bucket and send image bytes, so KIE never needs to
// download temporary frames through public r2.dev or presigned URLs.
export async function prepareAnalysisFrames(keys: string[]): Promise<string[]> {
  const frames: string[] = [];
  const signal = AbortSignal.timeout(15_000);
  for (let offset = 0; offset < keys.length; offset += 5) {
    const batch = await Promise.all(keys.slice(offset, offset + 5).map(async (key, index) => {
      let image: Buffer;
      try {
        signal.throwIfAborted();
        image = await getFromR2(key, MAX_ANALYSIS_FRAME_BYTES, signal);
      } catch (error) {
        const failure = ((error as Error)?.cause || error) as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (failure?.name === "NotFound" || failure?.name === "NoSuchKey" || failure?.$metadata?.httpStatusCode === 404) {
          throw new AnalysisFrameInputError(`分析帧 ${offset + index + 1} 已丢失或上传未完成，请重新上传后再试。`);
        }
        if (failure instanceof RangeError) {
          throw new AnalysisFrameInputError(`分析帧 ${offset + index + 1} 大小超出限制，请重新上传。`);
        }
        throw new Error("暂时无法读取分析帧，请稍后重试。", { cause: error });
      }
      if (image.byteLength < 3 || image.byteLength > MAX_ANALYSIS_FRAME_BYTES || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
        throw new AnalysisFrameInputError(`分析帧 ${offset + index + 1} 格式或大小无效，请重新上传。`);
      }
      return `data:image/jpeg;base64,${image.toString("base64")}`;
    }));
    frames.push(...batch);
  }
  return frames;
}
