export function canFullyReleaseTask(task: { state: string; kind: string; result: unknown } | undefined) {
  if (!task || task.state !== "review") return false;
  if (task.kind !== "analysis") return true;
  const result = task.result as { successfulSceneIds?: unknown } | null;
  return !Array.isArray(result?.successfulSceneIds) || result.successfulSceneIds.length === 0;
}
