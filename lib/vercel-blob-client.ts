"use client";

import { upload } from "@vercel/blob/client";

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

function safeFilename(filename: string) {
  const fallback = "upload";
  const sanitized = filename
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

export async function uploadMediaToBlob(
  file: File,
  onProgress?: (percentage: number) => void
): Promise<UploadedMedia> {
  const mediaType = getMediaType(file);
  const pathname = `uploads/${mediaType}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const contentType =
    file.type ||
    (mediaType === "video" ? "video/mp4" : "image/jpeg");

  const blob = await upload(pathname, file, {
    access: "public",
    handleUploadUrl: "/api/upload",
    contentType,
    multipart: file.size > 5 * 1024 * 1024,
    clientPayload: JSON.stringify({
      filename: file.name,
      size: file.size,
      contentType,
      mediaType,
    }),
    onUploadProgress: ({ percentage }) => {
      onProgress?.(percentage);
    },
  });

  return {
    url: blob.url,
    filename: file.name,
    mediaType,
    size: file.size,
    key: blob.pathname,
  };
}
