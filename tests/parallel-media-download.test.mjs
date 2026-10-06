import { describe, expect, it, vi } from "vitest";
import { downloadStreamsInParallel } from "../workers/ffmpeg-worker/parallel-download.mjs";

describe("parallel media downloads", () => {
  it("starts both streams before either finishes and waits for both", async () => {
    let finishVideo;
    let finishAudio;
    const video = vi.fn(() => new Promise((resolve) => { finishVideo = resolve; }));
    const audio = vi.fn(() => new Promise((resolve) => { finishAudio = resolve; }));
    let completed = false;
    const result = downloadStreamsInParallel(video, audio).then(() => { completed = true; });
    await vi.waitFor(() => expect(audio).toHaveBeenCalledOnce());
    expect(video).toHaveBeenCalledOnce();
    finishVideo();
    await Promise.resolve();
    expect(completed).toBe(false);
    finishAudio();
    await result;
    expect(completed).toBe(true);
  });

  it("stops the other stream before reporting a failed download", async () => {
    let writerStopped = false;
    const video = async () => { throw new Error("Download failed: 403"); };
    const audio = (signal) => new Promise((resolve) => signal.addEventListener("abort", () => { writerStopped = true; resolve(); }, { once: true }));
    await expect(downloadStreamsInParallel(video, audio)).rejects.toThrow("Download failed: 403");
    expect(writerStopped).toBe(true);
  });

  it("propagates caller cancellation to both streams", async () => {
    const controller = new AbortController();
    const stopped = [];
    const job = (name) => (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => { stopped.push(name); reject(new Error("Canceled")); }, { once: true }));
    const result = downloadStreamsInParallel(job("video"), job("audio"), controller.signal);
    const failure = expect(result).rejects.toThrow("Canceled");
    await Promise.resolve();
    controller.abort();
    await failure;
    expect(stopped.sort()).toEqual(["audio", "video"]);
  });

  it("supports a single muxed stream", async () => {
    const video = vi.fn().mockResolvedValue(undefined);
    await downloadStreamsInParallel(video);
    expect(video).toHaveBeenCalledOnce();
  });

  it("never starts downloads for an already canceled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const video = vi.fn();
    const audio = vi.fn();
    await expect(downloadStreamsInParallel(video, audio, controller.signal)).rejects.toThrow();
    expect(video).not.toHaveBeenCalled();
    expect(audio).not.toHaveBeenCalled();
  });
});
