import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media-resolver/easydown", () => ({ resolveLinkedMediaWithEasyDown: provider }));

beforeEach(() => {
  vi.resetModules();
  provider.mockReset().mockResolvedValue({ platform: "bilibili", videoUrl: "https://cdn.example/video.mp4", filename: "video.mp4" });
});
afterEach(() => vi.useRealTimers());

describe("private linked media source cache", () => {
  it("reuses a provider response for the same user and URL after a failed download", async () => {
    const { resolveLinkedMedia } = await import("@/lib/media-resolver");
    const first = await resolveLinkedMedia("https://b23.tv/demo", "owner");
    expect(await resolveLinkedMedia("https://b23.tv/demo", "owner")).toBe(first);
    expect(provider).toHaveBeenCalledOnce();
  });

  it("shares an in-flight call for simultaneous requests", async () => {
    let finish!: (value: { platform: string; videoUrl: string; filename: string }) => void;
    provider.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { resolveLinkedMedia } = await import("@/lib/media-resolver");
    const first = resolveLinkedMedia("https://b23.tv/demo", "owner");
    const second = resolveLinkedMedia("https://b23.tv/demo", "owner");
    expect(provider).toHaveBeenCalledOnce();
    finish({ platform: "bilibili", videoUrl: "https://cdn.example/video.mp4", filename: "video.mp4" });
    expect(await second).toEqual(await first);
  });

  it("never shares media between users or different URLs", async () => {
    const { resolveLinkedMedia } = await import("@/lib/media-resolver");
    await resolveLinkedMedia("https://b23.tv/demo", "owner");
    await resolveLinkedMedia("https://b23.tv/demo", "other");
    await resolveLinkedMedia("https://b23.tv/second", "owner");
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it("expires successful sources after ten minutes", async () => {
    vi.useFakeTimers();
    const { resolveLinkedMedia } = await import("@/lib/media-resolver");
    await resolveLinkedMedia("https://b23.tv/demo", "owner");
    vi.advanceTimersByTime(10 * 60_000);
    await resolveLinkedMedia("https://b23.tv/demo", "owner");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed provider calls", async () => {
    const { resolveLinkedMedia } = await import("@/lib/media-resolver");
    provider.mockRejectedValueOnce(new Error("Provider failed"));
    await expect(resolveLinkedMedia("https://b23.tv/demo", "owner")).rejects.toThrow("Provider failed");
    await resolveLinkedMedia("https://b23.tv/demo", "owner");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("does not spend a provider call when the bounded cache is full", async () => {
    const { resolveLinkedMedia } = await import("@/lib/media-resolver");
    for (let index = 0; index < 128; index++) await resolveLinkedMedia(`https://b23.tv/${index}`, "owner");
    await expect(resolveLinkedMedia("https://b23.tv/overflow", "owner")).rejects.toThrow("尚未调用收费解析接口");
    expect(provider).toHaveBeenCalledTimes(128);
    await resolveLinkedMedia("https://b23.tv/0", "owner");
    expect(provider).toHaveBeenCalledTimes(128);
  });
});
