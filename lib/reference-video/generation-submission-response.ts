import type { GenerationStage } from "./generation-progress";

export const generationStreamType = "application/x-ndjson";
export type GenerationReporter = (stage: GenerationStage) => void;

/** Existing callers retain JSON/status semantics. Streaming is explicitly opt-in. */
export function generationSubmissionResponse(request: Request, execute: (report: GenerationReporter) => Promise<Response>): Promise<Response> | Response {
  if (!request.headers.get("accept")?.includes(generationStreamType)) return execute(() => {});
  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(value: unknown) {
        if (disconnected) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); }
        catch { disconnected = true; }
      }
      try {
        const response = await execute(stage => send({ type: "stage", stage }));
        send({ type: "result", status: response.status, body: await response.json() });
      } catch {
        // No raw exception or provider details enter the progress protocol.
        send({ type: "result", status: 500, body: { code: "GENERATION_SUBMISSION_UNCONFIRMED", error: "Generation submission could not be confirmed." } });
      } finally {
        if (!disconnected) controller.close();
      }
    },
    // A disconnected browser must never retry or cancel a provider submission.
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": generationStreamType, "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
}
