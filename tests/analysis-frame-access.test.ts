import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/cloudflare/r2", () => ({ getFromR2: mocks.read }));
import { prepareAnalysisFrames } from "@/lib/ai/analysis-frame-access";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
describe("analysis frame read access", () => {
  beforeEach(() => { mocks.read.mockReset().mockResolvedValue(jpeg); });

  it("reads the uploaded keys with a size limit and shares one deadline across all frames", async () => {
    const keys = ["analysis-frames/user/run/frame-01.jpg", "analysis-frames/user/run/frame-02.jpg"];
    expect(await prepareAnalysisFrames(keys)).toEqual(keys.map(() => `data:image/jpeg;base64,${jpeg.toString("base64")}`));
    for (const key of keys) expect(mocks.read).toHaveBeenCalledWith(key, 2097152, expect.any(AbortSignal));
    expect(mocks.read.mock.calls[0][2]).toBe(mocks.read.mock.calls[1][2]);
  });

  it("fails before inference when an upload is missing", async () => {
    mocks.read.mockRejectedValue(new Error("Failed to get file", { cause: { $metadata: { httpStatusCode: 404 } } }));
    await expect(prepareAnalysisFrames(["missing.jpg"])).rejects.toThrow("已丢失或上传未完成");
  });

  it.each([Buffer.alloc(0), Buffer.alloc(2097153), Buffer.from("<html>404</html>")])("rejects invalid image bytes", async (bytes) => {
    mocks.read.mockResolvedValue(bytes);
    await expect(prepareAnalysisFrames(["invalid.jpg"])).rejects.toThrow("格式或大小无效");
  });

  it("reports the streaming size limit as invalid input", async () => {
    mocks.read.mockRejectedValue(new Error("Failed to get file", { cause: new RangeError("too large") }));
    await expect(prepareAnalysisFrames(["frame.jpg"])).rejects.toThrow("大小超出限制");
  });

  it("does not misreport storage authentication failures as missing user input", async () => {
    mocks.read.mockRejectedValue(new Error("Failed to get file", { cause: { $metadata: { httpStatusCode: 403 } } }));
    await expect(prepareAnalysisFrames(["frame.jpg"])).rejects.toThrow("暂时无法读取");
  });
});
