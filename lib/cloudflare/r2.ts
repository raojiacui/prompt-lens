import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// Backblaze B2 配置
const b2Region = process.env.B2_REGION || "us-west-000";
console.log("B2 env check:", {
  region: b2Region,
  bucket: process.env.B2_BUCKET_NAME,
  hasAccessKey: !!process.env.B2_ACCESS_KEY_ID,
  hasSecretKey: !!process.env.B2_SECRET_ACCESS_KEY,
  publicUrl: process.env.B2_PUBLIC_URL,
  accessKey: process.env.B2_ACCESS_KEY_ID,
});

const b2Config = {
  region: "us-east-1", // B2 S3 API 固定用 AWS 标准 region
  endpoint: `https://s3.${b2Region}.backblazeb2.com`,
  credentials: {
    accessKeyId: process.env.B2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
};

const bucketName = process.env.B2_BUCKET_NAME!;
const publicUrl = process.env.B2_PUBLIC_URL!;

// 创建 S3 客户端
const s3Client = new S3Client(b2Config);

/**
 * 上传文件到 B2
 */
export async function uploadToB2(
  file: Buffer | string,
  key: string,
  contentType: string
): Promise<string> {
  try {
    // 直接使用 PutObjectCommand（与测试接口一致）
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file,
      ContentType: contentType,
    });

    await s3Client.send(command);
    return `${publicUrl}/${key}`;
  } catch (error: any) {
    console.error("B2 upload error:", error);
    const errorMessage = error?.message || error?.Code || JSON.stringify(error);
    throw new Error(`B2 upload failed: ${errorMessage}`);
  }
}

/**
 * 从 B2 删除文件
 */
export async function deleteFromB2(key: string): Promise<void> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } catch (error) {
    console.error("B2 delete error:", error);
    throw new Error("Failed to delete file");
  }
}

/**
 * 从 B2 获取文件
 */
export async function getFromB2(key: string): Promise<Buffer> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );

    // 将流转换为 Buffer
    const stream = response.Body as any;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  } catch (error) {
    console.error("B2 get error:", error);
    throw new Error("Failed to get file");
  }
}

// 兼容旧函数名
export const uploadToR2 = uploadToB2;
export const deleteFromR2 = deleteFromB2;
export const getFromR2 = getFromB2;

/**
 * 生成签名 URL（私有 Bucket 访问方式）
 * @param key B2 中的文件 key
 * @param expiresIn 过期时间（秒），默认 3600（1小时）
 * @returns 带签名的可访问 URL
 */
export async function getSignedUrlFromB2(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error("B2 signed URL error:", error);
    throw new Error("Failed to generate signed URL");
  }
}

export const getSignedUrlFromR2 = getSignedUrlFromB2;

/**
 * 生成用户文件路径
 */
export function generateUserFilePath(
  userId: string,
  filename: string,
  type: "video" | "image"
): string {
  const ext = filename.split(".").pop();
  const uniqueName = `${randomUUID()}.${ext}`;
  return `users/${userId}/${type}/${uniqueName}`;
}

/**
 * 临时文件上传（用于视频处理）
 */
export async function uploadTempFile(
  filePath: string,
  filename: string
): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const contentType = getContentType(filename);
  const key = `temp/${randomUUID()}-${filename}`;

  const url = await uploadToB2(fileBuffer, key, contentType);

  // 删除本地临时文件
  try {
    await unlink(filePath);
  } catch (error) {
    console.warn("Failed to delete local temp file:", error);
  }

  return url;
}

/**
 * 根据文件扩展名获取 Content-Type
 */
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

/**
 * 检查文件类型是否允许
 */
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

/**
 * 检查文件大小是否超过限制
 */
export function isFileSizeValid(size: number, maxSizeMB: number = 100): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return size <= maxSizeBytes;
}
