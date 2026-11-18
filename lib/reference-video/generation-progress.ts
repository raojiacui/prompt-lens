export const generationStages = ["preparing", "moderating", "quoting", "submitting", "queued", "generating", "complete"] as const;
export type GenerationStage = typeof generationStages[number];
export type GenerationProgress = {
  stage: GenerationStage;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  commercial?: boolean;
  connection?: "ok" | "error";
  // Only stages actually confirmed by the server/client are marked complete.
  completed: GenerationStage[];
};

export function advanceGenerationProgress(previous: GenerationProgress | undefined, stage: GenerationStage, at = Date.now()): GenerationProgress {
  return {
    ...previous, stage, startedAt: previous?.startedAt ?? at, updatedAt: at, finishedAt: undefined,
    completed: previous && previous.stage !== stage
      ? [...new Set([...previous.completed, previous.stage])] : previous?.completed ?? [],
    connection: "ok",
  };
}

export function isGenerationStage(value: unknown): value is GenerationStage {
  return typeof value === "string" && generationStages.includes(value as GenerationStage);
}
