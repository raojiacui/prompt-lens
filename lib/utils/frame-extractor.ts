/**
 * 在浏览器中从视频文件提取帧
 * @param videoFile 视频文件
 * @param frameCount 需要提取的帧数
 * @param onProgress 进度回调
 * @returns 帧的 base64 数组
 */
export async function extractVideoFrames(
  videoFile: File,
  frameCount: number = 8,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Failed to get canvas context"));
      return;
    }

    const frames: string[] = [];
    const videoUrl = URL.createObjectURL(videoFile);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      // 设置 canvas 大小为视频原始大小
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const duration = video.duration;
      if (!duration || duration === Infinity) {
        URL.revokeObjectURL(videoUrl);
        reject(new Error("Invalid video duration"));
        return;
      }

      // 计算提取时间点（均匀分布）
      const interval = duration / (frameCount + 1);
      let currentFrame = 0;

      const extractFrame = () => {
        if (currentFrame >= frameCount) {
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
        // 转换为 base64
        const base64 = canvas.toDataURL("image/jpeg", 0.9);
        frames.push(base64);
        currentFrame++;
        onProgress?.(currentFrame, frameCount);
        extractFrame();
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
 * 从图片文件获取 base64
 */
export async function getImageBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}