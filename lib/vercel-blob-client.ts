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

  // 2. 用 XMLHttpRequest 直传 R2，支持进度回调。浏览器 CORS/network 失败时走服务端兜底上传。
  try {
    await uploadWithPresignedUrl(file, presignedUrl, contentType, onProgress);
  } catch (error) {
    if (!isDirectUploadNetworkError(error)) {
      throw error;
    }

    console.warn("Direct R2 upload failed, falling back to server upload:", error);
    return uploadViaServer(file, mediaType, contentType, onProgress);
  }

  await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      url: publicUrl,
      filename: file.name,
      mediaType,
      size: file.size,
    }),
  }).catch((error) => {
    console.warn("Failed to record upload completion:", error);
  });
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

function isDirectUploadNetworkError(error: unknown) {
  return error instanceof Error && error.message === "R2 upload network error";
}

async function uploadViaServer(
  file: File,
  mediaType: "video" | "image",
  contentType: string,
  onProgress?: (percentage: number) => void
): Promise<UploadedMedia> {
  onProgress?.(1);

  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", file.name);
  formData.append("contentType", contentType);
  formData.append("mediaType", mediaType);

  const uploadRes = await fetch("/api/upload-b2", {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok) {
    const message = await readUploadError(uploadRes, "Failed to upload via server");
    throw new Error(message);
  }

  const data = await uploadRes.json();
  onProgress?.(100);

  return {
    url: data.publicUrl,
    filename: file.name,
    mediaType,
    size: file.size,
    key: data.key,
  };
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
