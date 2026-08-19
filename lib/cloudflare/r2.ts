import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { readFile, unlink } from "fs/promises";

const accountId = process.env.R2_ACCOUNT_ID;
const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
const publicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

function requireR2Config() {
  const missing = [
    ["R2_ENDPOINT or R2_ACCOUNT_ID", endpoint],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET_NAME", bucketName],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`R2 storage is not configured. Missing: ${missing.map(([name]) => name).join(", ")}`);
  }
}

function requirePublicUrl() {
  if (!publicUrl) {
    throw new Error("R2_PUBLIC_URL is not configured");
  }
}

const s3Client = new S3Client({
  region: "auto",
  endpoint,
  credentials: accessKeyId && secretAccessKey
    ? {
        accessKeyId,
        secretAccessKey,
      }
    : undefined,
  forcePathStyle: true,
});

export function getR2PublicUrl(key: string): string {
  requirePublicUrl();
  return `${publicUrl}/${key.replace(/^\/+/, "")}`;
}

export function extractR2Key(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (endpoint && parsed.origin === new URL(endpoint).origin) {
      const pathname = parsed.pathname.replace(/^\/+/, "");
      const prefix = bucketName ? `${bucketName}/` : "";
      return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
    }

    if (parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
      const pathname = parsed.pathname.replace(/^\/+/, "");
      const prefix = bucketName ? `${bucketName}/` : "";
      return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
    }

    if (publicUrl && parsed.href.startsWith(`${publicUrl}/`)) {
      return parsed.href.slice(publicUrl.length + 1);
    }

    // Backward compatibility for records created before the R2 migration.
    const b2S3Match = url.match(/s3\.[a-z0-9-]+\.backblazeb2\.com\/[^/]+\/(.+)$/);
    if (b2S3Match) return b2S3Match[1];

    const b2FileMatch = url.match(/backblazeb2\.com\/file\/[^/]+\/(.+)$/);
    if (b2FileMatch) return b2FileMatch[1];
  } catch {
    return null;
  }

  return null;
}

export async function uploadToR2(
  file: Buffer | Uint8Array | string,
  key: string,
  contentType: string
): Promise<string> {
  try {
    requireR2Config();
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file,
      ContentType: contentType,
    });

    await s3Client.send(command);
    return getR2PublicUrl(key);
  } catch (error: any) {
    console.error("R2 upload error:", error);
    const errorMessage = error?.message || error?.Code || JSON.stringify(error);
    throw new Error(`R2 upload failed: ${errorMessage}`);
  }
}

export async function deleteFromR2(key: string): Promise<void> {
  try {
    requireR2Config();
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } catch (error) {
    console.error("R2 delete error:", error);
    throw new Error("Failed to delete file");
  }
}

export async function getFromR2(key: string): Promise<Buffer> {
  try {
    requireR2Config();
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    const stream = response.Body as any;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  } catch (error) {
    console.error("R2 get error:", error);
    throw new Error("Failed to get file");
  }
}

export async function getSignedUrlFromR2(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    requireR2Config();
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    console.error("R2 signed URL error:", error);
    throw new Error("Failed to generate signed URL");
  }
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    requireR2Config();
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    console.error("R2 presigned upload URL error:", error);
    throw new Error("Failed to generate presigned upload URL");
  }
}

export function generateUserFilePath(
  userId: string,
  filename: string,
  type: "video" | "image"
): string {
  const ext = filename.split(".").pop();
  const uniqueName = `${randomUUID()}.${ext}`;
  return `users/${userId}/${type}/${uniqueName}`;
}

export async function uploadTempFile(
  filePath: string,
  filename: string
): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const contentType = getContentType(filename);
  const key = `temp/${randomUUID()}-${filename}`;

  const url = await uploadToR2(fileBuffer, key, contentType);

  try {
    await unlink(filePath);
  } catch (error) {
    console.warn("Failed to delete local temp file:", error);
  }

  return url;
}

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    webm: "video/webm",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

export function isAllowedFileType(
  filename: string,
  allowedTypes: ("video" | "image")[]
): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  const allowedExtensions: Record<string, string[]> = {
    video: ["mp4", "mov", "avi", "mkv", "webm"],
    image: ["jpg", "jpeg", "png", "gif", "webp"],
  };

  return allowedTypes.some((type) =>
    allowedExtensions[type].includes(ext || "")
  );
}

export function isFileSizeValid(size: number, maxSizeMB: number = 100): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return size <= maxSizeBytes;
}

// Backward-compatible names for older routes/imports during migration.
export const uploadToB2 = uploadToR2;
export const deleteFromB2 = deleteFromR2;
export const getFromB2 = getFromR2;
export const getSignedUrlFromB2 = getSignedUrlFromR2;
