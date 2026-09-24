import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  checkRateLimit: vi.fn(),
  getPresignedUploadUrl: vi.fn(),
  getR2PublicUrl: vi.fn(),
  deleteFromR2: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  RateLimitConfigs: { upload: { limit: 10, windowMs: 60_000 } },
}));
vi.mock("@/lib/cloudflare/r2", () => ({
  getPresignedUploadUrl: mocks.getPresignedUploadUrl,
  getR2PublicUrl: mocks.getR2PublicUrl,
  deleteFromR2: mocks.deleteFromR2,
}));

import { DELETE, POST } from "@/app/api/upload-analysis-frames/route";

function request(frames: Array<{ filename: string; contentType: string; size: number }>) {
  return new NextRequest("http://localhost/api/upload-analysis-frames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frames }),
  });
}

describe("analysis frame upload route", () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ user: { id: "user/unsafe" } });
    mocks.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 9, resetIn: 60_000 });
    mocks.getPresignedUploadUrl.mockReset().mockImplementation(async (key: string) => `https://upload.example/${key}`);
    mocks.getR2PublicUrl.mockReset().mockImplementation((key: string) => `https://media.example/${key}`);
    mocks.deleteFromR2.mockReset().mockResolvedValue(undefined);
  });

  it("creates one upload ticket per compressed frame in a user-owned prefix", async () => {
    const response = await POST(request([
      { filename: "frame-1.jpg", contentType: "image/jpeg", size: 120_000 },
      { filename: "frame-2.jpg", contentType: "image/jpeg", size: 140_000 },
    ]));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.uploads).toHaveLength(2);
    expect(data.uploads[0].key).toMatch(/^analysis-frames\/user%2Funsafe\/[0-9a-f-]+\/frame-01\.jpg$/);
    expect(mocks.getPresignedUploadUrl).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized and non-JPEG frame payloads", async () => {
    const wrongType = await POST(request([{ filename: "frame.png", contentType: "image/png", size: 10 }]));
    expect(wrongType.status).toBe(400);

    const tooLarge = await POST(request([{ filename: "frame.jpg", contentType: "image/jpeg", size: 2_100_000 }]));
    expect(tooLarge.status).toBe(400);
  });

  it("caps the number of frames issued in one analysis", async () => {
    const frames = Array.from({ length: 31 }, (_, index) => ({
      filename: `frame-${index}.jpg`,
      contentType: "image/jpeg",
      size: 10,
    }));
    const response = await POST(request(frames));
    expect(response.status).toBe(400);
    expect(mocks.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("only deletes temporary frames owned by the signed-in user", async () => {
    const ownedKey = "analysis-frames/user%2Funsafe/run-1/frame-01.jpg";
    const response = await DELETE(new NextRequest("http://localhost/api/upload-analysis-frames", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: [ownedKey] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.deleteFromR2).toHaveBeenCalledWith(ownedKey);

    const otherUser = await DELETE(new NextRequest("http://localhost/api/upload-analysis-frames", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ["analysis-frames/other/run-1/frame-01.jpg"] }),
    }));
    expect(otherUser.status).toBe(400);
  });
});
