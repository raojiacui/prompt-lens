/**
 * 文件验证工具
 * 通过 Magic Number 验证文件类型，防止文件扩展名伪造
 */

import { Buffer } from "buffer";

// 文件 Magic Number 签名（null 表示该位置为通配符）
const FILE_SIGNATURES: Record<string, { signatures: (number | null)[][]; offset: number }> = {
  // 视频格式
  mp4: {
    signatures: [
      [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70], // ftyp
      [0x00, 0x00, 0x00, null, 0x6d, 0x6f, 0x6f, 0x76], // moov
      [0x00, 0x00, 0x00, null, 0x6d, 0x64, 0x61, 0x74], // mdat
    ],
    offset: 4,
  },
  mov: {
    signatures: [
      [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
      [0x00, 0x00, 0x00, null, 0x6d, 0x6f, 0x6f, 0x76],
      [0x00, 0x00, 0x00, null, 0x6d, 0x64, 0x61, 0x74],
    ],
    offset: 4,
  },
  avi: {
    signatures: [[0x52, 0x49, 0x46, 0x46]], // RIFF
    offset: 0,
  },
  mkv: {
    signatures: [[0x1a, 0x45, 0xdf, 0xa3]], // EBML
    offset: 0,
  },
  webm: {
    signatures: [[0x1a, 0x45, 0xdf, 0xa3]], // EBML
    offset: 0,
  },
  // 图片格式
  jpg: {
    signatures: [[0xff, 0xd8, 0xff]],
    offset: 0,
  },
  jpeg: {
    signatures: [[0xff, 0xd8, 0xff]],
    offset: 0,
  },
  png: {
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    offset: 0,
  },
  webp: {
    signatures: [
      [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50], // RIFF....WEBP
    ],
    offset: 0,
  },
  gif: {
    signatures: [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
    ],
    offset: 0,
  },
};

/**
 * 验证文件类型
 * @param buffer 文件内容的 Buffer
 * @param expectedExtension 期望的文件扩展名
 * @returns 是否验证通过
 */
export function validateFileSignature(buffer: Buffer, expectedExtension: string): boolean {
  const ext = expectedExtension.toLowerCase();
  const signatureInfo = FILE_SIGNATURES[ext];

  if (!signatureInfo) {
    // 未知文件类型，不验证
    console.warn(`Unknown file extension: ${ext}`);
    return true;
  }

  const { signatures, offset } = signatureInfo;

  for (const signature of signatures) {
    let match = true;

    for (let i = 0; i < signature.length; i++) {
      const sigByte = signature[i];
      if (sigByte === null) continue; // 通配符

      const bufferIndex = offset + i;
      if (bufferIndex >= buffer.length || buffer[bufferIndex] !== sigByte) {
        match = false;
        break;
      }
    }

    if (match) {
      return true;
    }
  }

  return false;
}

/**
 * 检测文件真实类型
 * @param buffer 文件内容的 Buffer
 * @returns 检测到的文件类型或 null
 */
export function detectFileType(buffer: Buffer): string | null {
  for (const [ext, info] of Object.entries(FILE_SIGNATURES)) {
    const { signatures, offset } = info;

    for (const signature of signatures) {
      let match = true;

      for (let i = 0; i < signature.length; i++) {
        const sigByte = signature[i];
        if (sigByte === null) continue;

        const bufferIndex = offset + i;
        if (bufferIndex >= buffer.length || buffer[bufferIndex] !== sigByte) {
          match = false;
          break;
        }
      }

      if (match) {
        return ext;
      }
    }
  }

  return null;
}

/**
 * 验证文件扩展名与内容匹配
 * @param filename 文件名
 * @param buffer 文件内容
 * @returns 验证结果
 */
export function validateFile(filename: string, buffer: Buffer): {
  valid: boolean;
  detectedType: string | null;
  error?: string;
} {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (!ext) {
    return {
      valid: false,
      detectedType: null,
      error: "No file extension",
    };
  }

  // 先检查扩展名是否在允许列表中
  const allowedExtensions = ["mp4", "mov", "avi", "mkv", "webm", "jpg", "jpeg", "png", "webp", "gif"];

  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      detectedType: null,
      error: `File extension ${ext} is not allowed`,
    };
  }

  // 验证 Magic Number
  const isValid = validateFileSignature(buffer, ext);

  if (!isValid) {
    const detectedType = detectFileType(buffer);
    return {
      valid: false,
      detectedType,
      error: `File content does not match extension .${ext}` + (detectedType ? ` (detected: .${detectedType})` : ""),
    };
  }

  return {
    valid: true,
    detectedType: ext,
  };
}
