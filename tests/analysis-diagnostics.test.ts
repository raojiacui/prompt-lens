import { describe, expect, it } from "vitest";
import { buildAnalysisDiagnostics } from "@/lib/billing/analysis-diagnostics";

const now = Date.parse("2026-11-03T09:00:00Z");
const task = () => ({ id: "task", state: "running", createdAt: new Date(now - 120000), updatedAt: new Date(now - 60000),
  input: { modelId: "gemini-3-8-flash-openai", keyFingerprint: "secret-fingerprint", mediaUrl: "https://private.test/?signature=secret", pricing: { scenes: [{ id: "a" }, { id: "b" }, { id: "c" }] } },
  result: { assets: { scenes: [{ keyframeUrls: [] }, { keyframeUrls: ["private-frame"] }, { keyframeUrls: [] }] } },
});
const job = (sceneIndex: number, state: string, result: unknown = {}) => ({ sceneIndex, state, result, createdAt: new Date(now - 100000), updatedAt: new Date(now - 10000) });

describe("analysis diagnostics projection", () => {
  it("distinguishes media preparation, model inference, saved responses and queued work", () => {
    const snapshot = buildAnalysisDiagnostics(task(), [job(1, "running", { phase: "preparing" }), job(2, "running", { phase: "analyzing" }), job(3, "queued")], now);
    expect(snapshot.stage).toBe("analyzing");
    expect(snapshot.scenes.map(s => s.stage)).toEqual(["preparing", "analyzing", "queued"]);
    expect(buildAnalysisDiagnostics(task(), [job(1, "running", { hasPendingBlueprint: true })], now).scenes[0].stage).toBe("saving");
  });
  it("returns only the explicit safe projection, never inputs, blueprint content or provider errors", () => {
    const snapshot = buildAnalysisDiagnostics(task(), [job(1, "running", { pendingBlueprint: { prompt: "private-answer" }, error: "private-key", timings: { modelMs: 42000, secret: "private-timing" }, failureCode: "private-error" })], now);
    expect(snapshot.scenes[0]).toMatchObject({ stage: "saving", modelMs: 42000, errorCode: "ANALYSIS_FAILED" });
    expect(JSON.stringify(snapshot)).not.toMatch(/private|secret|signature|Fingerprint|pendingBlueprint|mediaUrl/);
    expect(snapshot.observedAt).toBe(now);
  });
  it("does not label an unconfirmed task as executing", () => {
    expect(buildAnalysisDiagnostics({ ...task(), state: "quoted" }, [], now)).toMatchObject({ stage: "quoted", scenes: [{ stage: "queued" }, { stage: "queued" }, { stage: "queued" }] });
  });
  it("keeps terminal states and measured timings, rejecting invalid durations", () => {
    const snapshot = buildAnalysisDiagnostics({ ...task(), state: "completed" }, [job(1, "completed", { timings: { queueMs: 1000, preparationMs: 23000, modelMs: 42000, checkpointToSaveMs: -5 } }), job(2, "failed", { failureCode: "ANALYSIS_INTERRUPTED" })], now);
    expect(snapshot.stage).toBe("completed");
    expect(snapshot.scenes[0]).toMatchObject({ queueMs: 1000, preparationMs: 23000, modelMs: 42000 });
    expect(snapshot.scenes[0].saveMs).toBeUndefined();
    expect(snapshot.scenes[1]).toMatchObject({ stage: "failed", errorCode: "ANALYSIS_INTERRUPTED" });
  });
  it("shows only retried shots using their original indices", () => {
    const base = task();
    const snapshot = buildAnalysisDiagnostics({ ...base, input: { ...base.input, retry: { sceneVersions: [{ id: "c" }] } } }, [job(3, "queued")], now);
    expect(snapshot.scenes).toHaveLength(1);
    expect(snapshot.scenes[0].index).toBe(3);
  });
});
