export async function downloadStreamsInParallel(video, audio, parentSignal) {
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const downloads = [video, audio].filter(Boolean).map((download) => Promise.resolve().then(() => {
    signal.throwIfAborted();
    return download(signal);
  }));
  try {
    await Promise.all(downloads);
  } catch (error) {
    controller.abort();
    // Wait for both writers to stop before their temporary directory can be deleted.
    await Promise.allSettled(downloads);
    throw error;
  }
}
