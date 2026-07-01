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
 * 通过 B2 presigned URL 直传文件，不经过 Vercel 服务器。
 * 文件大小上限 5GB（B2 PUT 单次上限）。
 */
export async function uploadMediaToBlob(
  file: File,
  onProgress?: (percentage: number) => void
): Promise<UploadedMedia> {
  const mediaType = getMediaType(file);
  const contentType = file.type || (mediaType === "video" ? "video/mp4" : "image/jpeg");

  // 1. 从后端拿 presigned URL
  const tokenRes = await fetch("/api/upload-b2", {
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

  // 2. 用 XMLHttpRequest 直传 B2，支持进度回调
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
        reject(new Error(`B2 upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("B2 upload network error"));
    xhr.onabort = () => reject(new Error("B2 upload aborted"));

    xhr.send(file);
  });

  return {
    url: publicUrl,
    filename: file.name,
    mediaType,
    size: file.size,
    key,
  };
}
