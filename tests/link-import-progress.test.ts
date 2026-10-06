import { describe, expect, it } from "vitest";
import { LinkImportError, readLinkImportResponse } from "@/lib/media-resolver/import-progress";

function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
    controller.close();
  } }), { headers: { "Content-Type": "application/x-ndjson" } });
}

describe("link import progress response", () => {
  it("reads fragmented UTF-8 events, heartbeats and the final result", async () => {
    const stages: string[] = [];
    const response = streamed([
      { type: "stage", stage: "checking-worker" },
      { type: "heartbeat" },
      { type: "stage", stage: "saving" },
      { type: "result", data: { mediaUrl: "https://r2.example/视频.mp4", title: "中文标题" } },
    ].map((event) => JSON.stringify(event)).join("\n"));
    expect(await readLinkImportResponse(response, (stage) => stages.push(stage))).toMatchObject({ title: "中文标题" });
    expect(stages).toEqual(["checking-worker", "saving"]);
  });

  it("preserves retry codes and stops on a streamed failure", async () => {
    const response = streamed(JSON.stringify({ type: "error", code: "LINK_IMPORT_FAILED", error: "下载中断" }));
    await expect(readLinkImportResponse(response, () => undefined)).rejects.toMatchObject({ code: "LINK_IMPORT_FAILED", message: "下载中断" });
  });

  it("does not treat an interrupted stream as a successful import", async () => {
    await expect(readLinkImportResponse(streamed('{"type":"heartbeat"}\n'), () => undefined)).rejects.toThrow("尚未确认完成");
  });

  it("accepts older JSON success responses", async () => {
    expect(await readLinkImportResponse(Response.json({ mediaUrl: "https://r2.example/video.mp4" }), () => undefined)).toMatchObject({ mediaUrl: expect.any(String) });
  });

  it("preserves ordinary JSON errors", async () => {
    await expect(readLinkImportResponse(Response.json({ error: "Unauthorized", code: "AUTH" }, { status: 401 }), () => undefined)).rejects.toBeInstanceOf(LinkImportError);
  });
});
