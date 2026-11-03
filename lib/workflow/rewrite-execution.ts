export const REWRITE_BUDGET_MS = 240_000;
export const REWRITE_STALE_MS = 360_000;
export type RewriteStage = "generating" | "reviewing" | "correcting";
export class SceneRewriteError extends Error {
  constructor(message: string, readonly code: "REWRITE_TIMEOUT" | "REWRITE_REVIEW_FAILED" | "REWRITE_INVALID_RESULT" | "REWRITE_PROVIDER_FAILED", readonly stage: RewriteStage, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SceneRewriteError";
  }
}
