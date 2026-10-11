export function canFullyReleaseTask(task: { state: string; kind: string; result: unknown } | undefined) {
  if (!task || task.state !== "review" || task.kind !== "analysis") return false;
  const result = task.result as { review?: unknown; successfulSceneIds?: unknown; splitDelivered?: unknown; pendingResult?: unknown } | null;
  return Boolean(result?.review) && (!Array.isArray(result?.successfulSceneIds) || result.successfulSceneIds.length === 0)
    && result?.splitDelivered !== true && !result?.pendingResult;
}
