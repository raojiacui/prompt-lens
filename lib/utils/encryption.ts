import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * API Key 加密工具
 * 使用 AES-256-GCM 加密用户存储的 API Key
 */

// 获取加密密钥（从环境变量派生）
function getEncryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not configured");
  }
  // 使用 secret 的前32字节作为 AES-256 密钥
  return scryptSync(secret, "salt", 32);
}

/**
 * 加密 API Key
 */
export function encryptApiKey(plainText: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // 返回格式: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * 解密 API Key
 */
export function decryptApiKey(encryptedText: string): string {
  const key = getEncryptionKey();

  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted API key format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * 验证加密格式是否有效
 */
export function isValidEncryptedKey(encryptedText: string): boolean {
  try {
    const parts = encryptedText.split(":");
    // IV (16 bytes = 32 hex) + authTag (16 bytes = 32 hex) + encrypted content
    return parts.length === 3 && parts[0].length === 32 && parts[1].length === 32;
  } catch {
    return false;
  }
}
