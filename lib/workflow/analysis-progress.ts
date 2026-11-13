/** Display confirmed checkpoints; elapsed time is not completed model work. */
export function workflowAnalysisPercent(input: { phase?: string; total: number; finished: number }) {
  if (!input.total || input.phase === "preparing" || input.phase === "queued") return 60;
  if (input.phase === "saving") return 95;
  const finished = Math.max(0, Math.min(input.total, input.finished));
  return 65 + Math.round(finished / input.total * 30);
}
