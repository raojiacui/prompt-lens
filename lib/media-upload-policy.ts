export const UPLOAD_MAX_BYTES = { video: 500 * 1024 * 1024, image: 20 * 1024 * 1024 } as const;
export const ANALYSIS_MAX_BYTES = { video: 100 * 1024 * 1024, image: 20 * 1024 * 1024 } as const;

export function validUploadSize(size: unknown, type: "video" | "image"): size is number {
  return typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size <= UPLOAD_MAX_BYTES[type];
}
