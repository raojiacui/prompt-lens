import { isGenerationStage, type GenerationStage } from "./generation-progress";

export class GenerationSubmissionInterrupted extends Error {
  constructor() { super("GENERATION_SUBMISSION_INTERRUPTED"); }
}

type SubmissionResult = { status: number; body: Record<string, unknown> };

export async function readGenerationSubmission(response: Response, onStage: (stage: GenerationStage) => void): Promise<SubmissionResult> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await response.json().catch(() => null);
    return { status: response.status, body: body && typeof body === "object" && !Array.isArray(body) ? body : {} };
  }
  if (!response.body) throw new GenerationSubmissionInterrupted();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SubmissionResult | undefined;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "stage" && isGenerationStage(event.stage)) onStage(event.stage);
    if (event.type === "result" && Number.isInteger(event.status) && event.status >= 200 && event.status <= 599
      && event.body && typeof event.body === "object" && !Array.isArray(event.body)) result = { status: event.status, body: event.body };
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) consume(line);
      if (done) { consume(buffer); break; }
      if (buffer.length > 65536) throw new GenerationSubmissionInterrupted();
    }
    if (!result) throw new GenerationSubmissionInterrupted();
    return result;
  } catch { throw new GenerationSubmissionInterrupted(); }
  finally { reader.releaseLock(); }
}
