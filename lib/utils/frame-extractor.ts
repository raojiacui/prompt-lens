/**
 * 在浏览器中从视频文件提取帧
 * @param videoFile 视频文件
 * @param frameCount 需要提取的帧数
 * @param onProgress 进度回调
 * @returns 压缩后的 JPEG 帧文件
 */
export async function extractVideoFrameFiles(
  videoFile: File,
  frameCount: number = 8,
  onProgress?: (current: number, total: number) => void
): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const targetFrameCount = Number.isFinite(frameCount)
      ? Math.min(30, Math.max(1, Math.round(frameCount)))
      : 8;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Failed to get canvas context"));
      return;
    }

    const frames: File[] = [];
    const videoUrl = URL.createObjectURL(videoFile);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const size = fitWithin(video.videoWidth, video.videoHeight, 1024);
      canvas.width = size.width;
      canvas.height = size.height;

      const duration = video.duration;
      if (!duration || duration === Infinity) {
        URL.revokeObjectURL(videoUrl);
        reject(new Error("Invalid video duration"));
        return;
      }

      // 计算提取时间点（均匀分布）
      const interval = duration / (targetFrameCount + 1);
      let currentFrame = 0;

      const extractFrame = () => {
        if (currentFrame >= targetFrameCount) {
          // 提取完成
          URL.revokeObjectURL(videoUrl);
          resolve(frames);
          return;
        }

        const time = interval * (currentFrame + 1);
        video.currentTime = time;
      };

      video.onseeked = () => {
        // 绘制当前帧到 canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            URL.revokeObjectURL(videoUrl);
            reject(new Error("Failed to encode video frame"));
            return;
          }
          frames.push(new File([blob], `frame-${String(currentFrame + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }));
          currentFrame++;
          onProgress?.(currentFrame, targetFrameCount);
          extractFrame();
        }, "image/jpeg", 0.72);
      };

      video.onerror = () => {
        URL.revokeObjectURL(videoUrl);
        reject(new Error("Failed to load video"));
      };

      // 开始提取
      extractFrame();
    };

    video.onerror = () => {
      URL.revokeObjectURL(videoUrl);
      reject(new Error("Failed to load video file"));
    };

    video.src = videoUrl;
  });
}

/**
 * 为图片分析生成尺寸受控的 JPEG 帧。
 */
export async function createImageAnalysisFrame(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const imageUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = fitWithin(image.naturalWidth, image.naturalHeight, 1024);
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(imageUrl);
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(imageUrl);
        if (!blob) {
          reject(new Error("Failed to encode image frame"));
          return;
        }
        resolve(new File([blob], "frame-01.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.72);
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error("Failed to load image"));
    };
    image.src = imageUrl;
  });
}

function fitWithin(width: number, height: number, maxEdge: number) {
  if (!width || !height) return { width: maxEdge, height: maxEdge };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
