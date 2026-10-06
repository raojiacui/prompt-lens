export type LinkImportStage = "checking-worker" | "resolving" | "saving";

export class LinkImportError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

export async function readLinkImportResponse(
  response: Response,
  onStage: (stage: LinkImportStage) => void,
): Promise<Record<string, unknown>> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw new LinkImportError(data.error || "视频链接导入失败", data.code);
    return data;
  }
  if (!response.body) throw new LinkImportError("视频链接导入连接中断，请勿连续重复提交。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: Record<string, unknown> | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      if (done && pending.trim()) { lines.push(pending); pending = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "stage" && ["checking-worker", "resolving", "saving"].includes(event.stage)) onStage(event.stage);
        if (event.type === "error") throw new LinkImportError(event.error || "视频链接导入失败", event.code);
        if (event.type === "result") result = event.data;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!result?.mediaUrl) throw new LinkImportError("视频链接导入连接中断，尚未确认完成，请勿连续重复提交。");
  return result;
}
