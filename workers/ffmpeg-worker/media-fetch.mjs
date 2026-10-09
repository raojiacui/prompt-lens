import { setTimeout as delay } from "node:timers/promises";

const transientCodes = new Set(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

export async function fetchMedia(url, options, fetchImpl = fetch, wait = delay) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchImpl(url, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const code = error.cause?.code || error.code;
      if (!transientCodes.has(code) || attempt === 2) {
        const host = new URL(url).hostname;
        const reason = code === "EAI_AGAIN" || code === "ENOTFOUND"
          ? "媒体下载失败：视频资源域名解析失败"
          : "媒体下载失败：视频资源连接失败";
        throw new Error(`${reason}（${host}${code ? `，${code}` : ""}）。尚未完成素材入库。`, { cause: error });
      }
      await wait(500 * (attempt + 1), undefined, { signal: options.signal });
    }
  }
}
