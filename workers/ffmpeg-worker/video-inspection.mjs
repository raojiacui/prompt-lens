function inspectionError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, statusCode: 422 });
}

// Dimensions alone can be present for a stream whose codec (for example bvc2)
// has no decoder. Validate a real frame before accepting or storing the video.
export async function inspectVideoProbe(probe, decodeFrame) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const videos = streams.filter(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const candidates = videos.filter(stream => {
    const codec = String(stream.codec_name || "").toLowerCase();
    return codec && !["none", "unknown"].includes(codec) &&
      Number.isInteger(stream.index) && stream.index >= 0 &&
      Number(stream.width) > 0 && Number(stream.height) > 0;
  });
  if (!candidates.length) {
    throw inspectionError("UNSUPPORTED_VIDEO_CODEC", "视频编码暂不支持，未找到可解码的视频流，请使用 H.264 或 H.265 视频。");
  }
  let lastError;
  for (const video of candidates) {
    try {
      await decodeFrame(video.index);
      const fpsParts = String(video.avg_frame_rate || video.r_frame_rate || "0/1").split("/").map(Number);
      const fps = fpsParts[1] ? fpsParts[0] / fpsParts[1] : fpsParts[0] || undefined;
      return {
        duration: Number(probe.format?.duration || video.duration || 0),
        width: Number(video.width),
        height: Number(video.height),
        fps,
        hasAudio: streams.some(stream => stream.codec_type === "audio"),
        videoStreamIndex: video.index,
        // PySceneDetect opens the first video stream. Use explicitly mapped
        // FFmpeg detection when an earlier video stream cannot be decoded.
        useFfmpegSceneDetection: video.index !== streams.find(stream => stream.codec_type === "video")?.index,
      };
    } catch (error) {
      // Process startup failures and cancellation are not evidence about codecs.
      if (error?.name === "AbortError" || error?.code) throw error;
      lastError = error;
    }
  }
  throw inspectionError("INVALID_VIDEO_STREAM", "视频画面无法解码，请使用可正常播放的 H.264 或 H.265 视频。", lastError);
}

export async function detectWithFallback(primary, fallback, onPrimaryFailure = () => {}) {
  try {
    const result = await primary();
    if (result) return result;
  } catch (error) {
    if (["AbortError", "TimeoutError"].includes(error?.name)) throw error;
    onPrimaryFailure(error);
  }
  try {
    // A successful detector may legitimately find zero cuts. A failed detector
    // must never be presented or billed as a successful single-shot preview.
    return await fallback();
  } catch (error) {
    if (["AbortError", "TimeoutError"].includes(error?.name)) throw error;
    throw inspectionError("SCENE_DETECTION_FAILED", "镜头检测失败，尚未生成有效的拆镜预览，请换用可解码的视频后重试。", error);
  }
}

export async function ingestVideoCandidates(source, { inspect, download }, signal) {
  const candidates = [source, ...(Array.isArray(source.videoCandidates) ? source.videoCandidates : [])];
  const seen = new Set();
  let lastError;
  let unconfirmed = false;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.videoUrl !== "string" || seen.has(candidate.videoUrl)) continue;
    if (seen.size >= 12) break;
    seen.add(candidate.videoUrl);
    signal?.throwIfAborted();
    try {
      if (candidate.videoCodec === "bvc2") throw inspectionError("UNSUPPORTED_VIDEO_CODEC", "该视频版本编码不受支持。");
      const probe = await inspect(candidate);
      if (!["h264", "hevc"].includes(probe?.codec)) throw inspectionError("UNSUPPORTED_VIDEO_CODEC", "该视频版本编码不受支持。");
      // Only the selected, preflighted rendition reaches the full download.
      return await download(candidate);
    } catch (error) {
      if (!["UNSUPPORTED_VIDEO_CODEC", "INVALID_VIDEO_STREAM", "VIDEO_CODEC_PREFLIGHT_FAILED"].includes(error?.code)) throw error;
      if (error.code === "VIDEO_CODEC_PREFLIGHT_FAILED") unconfirmed = true;
      lastError = error;
    }
  }
  if (unconfirmed) throw inspectionError("VIDEO_CODEC_PREFLIGHT_FAILED", "无法在完整下载前确认受支持的视频版本，请更换链接或上传 H.264 MP4 文件。", lastError);
  throw inspectionError(lastError?.code || "INVALID_VIDEO_STREAM", "链接未提供当前支持的视频编码版本，请上传 H.264 或 H.265 视频。", lastError);
}
