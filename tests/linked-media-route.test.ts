import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveLinkedMedia: vi.fn(),
  ingestLinkedMedia: vi.fn(),
  insertValues: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  settleInTransaction: vi.fn(),
  selectResult: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/media-resolver", () => ({ resolveLinkedMedia: mocks.resolveLinkedMedia }));
vi.mock("@/lib/ffmpeg-worker/client", () => ({ ingestLinkedMediaWithWorker: mocks.ingestLinkedMedia }));
vi.mock("@/lib/billing/commercial-wallet", () => ({
  reserveCommercialTask: mocks.reserve,
  settleCommercialTask: mocks.settle,
  settleCommercialTaskInTransaction: mocks.settleInTransaction,
}));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({ insert: () => ({ values: mocks.insertValues }) }),
    select: () => ({ from: () => ({ where: mocks.selectResult }) }),
  },
  operationLogs: { userId: "userId", metadata: "metadata" },
}));

import { POST } from "@/app/api/media/resolve-link/route";

const requestId = "6813e04d-c905-4fa6-a11c-ea35bbd42f0a";
const originalConsumptionEnabled = process.env.COMMERCIAL_CONSUMPTION_ENABLED;

function request(url = "https://www.bilibili.com/video/BV1sW4y197cE/", origin = "http://localhost") {
  return new NextRequest("http://localhost/api/media/resolve-link", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ url, requestId }),
  });
}

describe("linked media resolver route", () => {
  afterAll(() => {
    if (originalConsumptionEnabled === undefined) delete process.env.COMMERCIAL_CONSUMPTION_ENABLED;
    else process.env.COMMERCIAL_CONSUMPTION_ENABLED = originalConsumptionEnabled;
  });
  beforeEach(() => {
    process.env.COMMERCIAL_CONSUMPTION_ENABLED = "true";
    mocks.getSession.mockReset().mockResolvedValue({ user: { id: "owner" } });
    mocks.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 2, resetIn: 60_000 });
    mocks.resolveLinkedMedia.mockReset().mockResolvedValue({
      platform: "bilibili",
      videoUrl: "https://provider.example/video",
      videoHeaders: { Referer: "https://www.bilibili.com/" },
      filename: "bilibili-linked-video.mp4",
      title: "A useful demo",
      duration: 42,
    });
    mocks.ingestLinkedMedia.mockReset().mockResolvedValue({
      mediaUrl: "https://media.example/linked-video.mp4",
      storageKey: "linked-media/bilibili/id.mp4",
      mediaType: "video",
      platform: "bilibili",
      filename: "bilibili-linked-video.mp4",
      metadata: { duration: 42, width: 1920, height: 1080 },
    });
    mocks.insertValues.mockReset().mockResolvedValue(undefined);
    mocks.reserve.mockReset().mockResolvedValue({ created: true, reservation: { state: "held" } });
    mocks.settle.mockReset().mockResolvedValue(undefined);
    mocks.settleInTransaction.mockReset().mockResolvedValue(undefined);
    mocks.selectResult.mockReset().mockResolvedValue([]);
  });

  it("stores resolved media as an owned upload for the analysis flow", async () => {
    const response = await POST(request());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ platform: "bilibili", duration: 42, title: "A useful demo" });
    expect(data.chargedCredits).toBe(0);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", credits: 0, rewrites: 0 }));
    expect(mocks.settleInTransaction).toHaveBeenCalledWith(expect.anything(), { userId: "owner", taskKey: `link-import:${requestId}`, credits: 0, rewrites: 0 });
    expect(mocks.ingestLinkedMedia).toHaveBeenCalledWith(expect.objectContaining({ platform: "bilibili", videoHeaders: { Referer: "https://www.bilibili.com/" } }));
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner",
      action: "file.upload",
      metadata: expect.objectContaining({ phase: "server-upload", source: "linked-media" }),
    }));
  });

  it("rejects cross-origin requests before spending a provider call", async () => {
    const response = await POST(request(undefined, "https://other.example"));
    expect(response.status).toBe(403);
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
  });

  it("rate limits repeated resolutions per user", async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetIn: 12_000 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
  });

  it("rejects YouTube before making a paid provider call", async () => {
    const response = await POST(request("https://www.youtube.com/watch?v=demo"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "暂不支持 YouTube 视频链接" });
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
    expect(mocks.ingestLinkedMedia).not.toHaveBeenCalled();
  });

  it("rejects X before making a paid provider call", async () => {
    const response = await POST(request("https://x.com/example/status/123"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "暂不支持 X 视频链接" });
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
    expect(mocks.ingestLinkedMedia).not.toHaveBeenCalled();
  });

  it("returns a service error when the provider key is not configured", async () => {
    mocks.resolveLinkedMedia.mockRejectedValue(new Error("链接解析服务未配置：请设置 LEAPERONE_API_KEY"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "LINK_RESOLVER_NOT_CONFIGURED", error: "视频链接解析服务尚未启用。" });
    expect(mocks.settle).toHaveBeenCalledWith({ userId: "owner", taskKey: `link-import:${requestId}`, credits: 0, rewrites: 0 });
  });

  it("does not call the paid provider when the included attempts are exhausted", async () => {
    mocks.reserve.mockRejectedValue(new Error("LINK_IMPORT_ALLOWANCE_EXHAUSTED"));
    const response = await POST(request());
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "LINK_IMPORT_ALLOWANCE_EXHAUSTED" });
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
  });

  it("replays a completed import without a second provider call or charge", async () => {
    mocks.reserve.mockResolvedValue({ created: false, reservation: { state: "settled", settledCredits: 0 } });
    mocks.selectResult.mockResolvedValue([{ metadata: { linkImportResult: { mediaUrl: "https://media.example/linked-video.mp4", chargedCredits: 0 } } }]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).mediaUrl).toBe("https://media.example/linked-video.mp4");
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
    expect(mocks.settleInTransaction).not.toHaveBeenCalled();
  });

  it("does not repeat a provider call while the original import is pending", async () => {
    mocks.reserve.mockResolvedValue({ created: false, reservation: { state: "held" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.resolveLinkedMedia).not.toHaveBeenCalled();
  });

  it("releases held credits when storing the resolved video fails", async () => {
    mocks.ingestLinkedMedia.mockRejectedValue(new Error("Worker download failed"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(mocks.settle).toHaveBeenCalledWith({ userId: "owner", taskKey: `link-import:${requestId}`, credits: 0, rewrites: 0 });
    expect(mocks.settleInTransaction).not.toHaveBeenCalled();
  });
});
