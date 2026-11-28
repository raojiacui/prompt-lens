import { sql } from "drizzle-orm";

export const ANALYSIS_RESULT_RECOVERY_MS = 20_000;
export const analysisSaveTimeouts = sql`SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '15s', true), set_config('idle_in_transaction_session_timeout', '20s', true)`;

// Shared by paid video scenes and uploaded-file analysis. Never retry inference.
export function retryableAnalysisSaveError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const value = error as { code?: string; cause?: unknown };
  return ["40001", "40P01", "55P03", "57014", "08006", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "ECONNRESET"].includes(value.code || "")
    || retryableAnalysisSaveError(value.cause, depth + 1);
}
