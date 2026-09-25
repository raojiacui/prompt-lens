"use client";

const VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "mkv", "webm"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export type UploadedMedia = {
  url: string;
  filename: string;
  mediaType: "video" | "image";
  size: number;
  key: string;
};

function getMediaType(file: File): "video" | "image" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";

  throw new Error("Unsupported file type");
}

/**
 * 通过 R2 presigned URL 直传文件，不经过 Vercel 服务器。
 * 视频文件大小上限由后端配置控制。
 */
export async function uploadMediaToR2(
  file: File,
  onProgress?: (percentage: number) => void
): Promise<UploadedMedia> {
  const mediaType = getMediaType(file);
  const contentType = file.type || (mediaType === "video" ? "video/mp4" : "image/jpeg");

  // 1. 从后端拿 presigned URL
  const tokenRes = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      size: file.size,
      mediaType,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({ error: "Failed to get upload URL" }));
    throw new Error(err.error || `Failed to get upload URL (${tokenRes.status})`);
  }

  const { presignedUrl, publicUrl, key } = await tokenRes.json();

  await uploadWithPresignedUrl(file, presignedUrl, contentType, onProgress);

  const completion = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      url: publicUrl,
      filename: file.name,
      mediaType,
      size: file.size,
    }),
  });
  if (!completion.ok) {
    throw new Error(await readUploadError(completion, "Failed to verify R2 upload"));
  }
  return {
    url: publicUrl,
    filename: file.name,
    mediaType,
    size: file.size,
    key,
  };
}

async function uploadWithPresignedUrl(
  file: File,
  presignedUrl: string,
  contentType: string,
  onProgress?: (percentage: number) => void
) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`R2 upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("R2 upload failed. Check R2 CORS and your connection, then retry."));
    xhr.onabort = () => reject(new Error("R2 upload aborted"));

    xhr.send(file);
  });
}

async function readUploadError(response: Response, fallback: string) {
  const status = `${response.status} ${response.statusText}`.trim();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const err = await response.json().catch(() => null);
    const message = typeof err?.error === "string" ? err.error : fallback;
    return `${message} (${status})`;
  }

  const text = await response.text().catch(() => "");
  const detail = text.replace(/\s+/g, " ").trim().slice(0, 300);
  return detail ? `${fallback}: ${detail} (${status})` : `${fallback} (${status})`;
}
