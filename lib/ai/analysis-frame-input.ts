export const MAX_ANALYSIS_FRAMES = 30;
export const MAX_ANALYSIS_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_FRAME_PAYLOAD_CHARS = 4 * 1024 * 1024;

type ResolveAnalysisFramesOptions = {
  userId: string;
  frameUrls: unknown;
  clientFrames: unknown;
  extractKey: (url: string) => string | null;
};

export class AnalysisFrameInputError extends Error {}

export function analysisFrameOwnerPrefix(userId: string) {
  const safeUserId = encodeURIComponent(userId);
  return `analysis-frames/${safeUserId}/`;
}

export function resolveAnalysisFrames({
  userId,
  frameUrls,
  clientFrames,
  extractKey,
}: ResolveAnalysisFramesOptions): { frames: string[]; temporaryKeys: string[] } {
  if (Array.isArray(frameUrls) && frameUrls.length > 0) {
    if (frameUrls.length > MAX_ANALYSIS_FRAMES) {
      throw new AnalysisFrameInputError(`Too many analysis frames. Maximum: ${MAX_ANALYSIS_FRAMES}`);
    }

    const ownerPrefix = analysisFrameOwnerPrefix(userId);
    const temporaryKeys = frameUrls.map((value) => {
      if (typeof value !== "string" || value.length > 2_048) {
        throw new AnalysisFrameInputError("Invalid analysis frame URL");
      }
      const key = extractKey(value);
      if (!key || !key.startsWith(ownerPrefix) || !/\.jpe?g$/i.test(key)) {
        throw new AnalysisFrameInputError("Invalid analysis frame URL");
      }
      return key;
    });

    return { frames: frameUrls as string[], temporaryKeys };
  }

  if (Array.isArray(clientFrames) && clientFrames.length > 0) {
    if (clientFrames.length > MAX_ANALYSIS_FRAMES) {
      throw new AnalysisFrameInputError(`Too many analysis frames. Maximum: ${MAX_ANALYSIS_FRAMES}`);
    }
    if (!clientFrames.every((frame) => typeof frame === "string" && /^data:image\/(?:jpeg|png|webp);base64,/i.test(frame))) {
      throw new AnalysisFrameInputError("Invalid legacy frame payload");
    }
    const totalChars = clientFrames.reduce((sum, frame) => sum + (frame as string).length, 0);
    if (totalChars > MAX_LEGACY_FRAME_PAYLOAD_CHARS) {
      throw new AnalysisFrameInputError("Legacy frame payload is too large. Please refresh and try again.");
    }
    return { frames: clientFrames as string[], temporaryKeys: [] };
  }

  throw new AnalysisFrameInputError("No analysis frames available");
}
