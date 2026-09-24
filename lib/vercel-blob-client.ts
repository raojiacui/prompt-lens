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

  // 2. 用 XMLHttpRequest 直传 R2，支持进度回调
  await uploadWithPresignedUrl(file, presignedUrl, contentType, onProgress);

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

    xhr.onerror = () => reject(new Error("R2 upload network error"));
    xhr.onabort = () => reject(new Error("R2 upload aborted"));

    xhr.send(file);
  });
}

export async function uploadAnalysisFrames(
  frames: File[],
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const response = await fetch("/api/upload-analysis-frames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      frames: frames.map((frame) => ({
        filename: frame.name,
        contentType: frame.type,
        size: frame.size,
      })),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to prepare frame uploads" }));
    throw new Error(error.error || `Failed to prepare frame uploads (${response.status})`);
  }

  const data = await response.json();
  if (!Array.isArray(data.uploads) || data.uploads.length !== frames.length) {
    throw new Error("Invalid frame upload response");
  }

  const urls = new Array<string>(frames.length);
  let nextIndex = 0;
  let completed = 0;
  const uploadNext = async (): Promise<void> => {
    const index = nextIndex++;
    if (index >= frames.length) return;
    const upload = data.uploads[index];
    if (typeof upload?.presignedUrl !== "string" || typeof upload?.publicUrl !== "string") {
      throw new Error("Invalid frame upload response");
    }
    await uploadWithPresignedUrl(frames[index], upload.presignedUrl, "image/jpeg");
    urls[index] = upload.publicUrl;
    completed++;
    onProgress?.(completed, frames.length);
    await uploadNext();
  };

  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(3, frames.length) }, () => uploadNext())
  );
  const failedWorker = workers.find((result) => result.status === "rejected");
  if (failedWorker?.status === "rejected") {
    await fetch("/api/upload-analysis-frames", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: data.uploads.map((upload: { key: string }) => upload.key) }),
    }).catch(() => undefined);
    throw failedWorker.reason;
  }
  return urls;
}
