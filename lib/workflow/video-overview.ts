type OverviewScene = {
  sceneIndex: number;
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  transition: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function meaningful(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || /Reference-driven|editable scene blueprint|Scene-level structure|Follow detected scene boundaries|Use extracted audio cues|Use the first scene|生成前需要|保留原始时长|保留原始剪辑|Selected analysis provider/i.test(text)) return "";
  return text;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readableVideoOverview(overview: Record<string, unknown>, scenes: OverviewScene[]) {
  const valid = [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex).filter(scene => scene.metadata?.analysisProvider !== "fallback");
  const nested = record(overview.video_summary || overview.videoSummary || overview.summary);
  const narrative = [overview.narrative, typeof overview.summary === "string" ? overview.summary : null, nested.summary, nested.narrative].map(meaningful).find(Boolean);
  const paragraphs = narrative ? [narrative] : valid.map(scene => meaningful(scene.story.summary) || meaningful(scene.visual.sceneDescription)).filter(Boolean);
  const unique = (values: unknown[]) => [...new Set(values.map(meaningful).filter(Boolean))].slice(0, 3).join(" ");
  return {
    paragraphs: [...new Set(paragraphs)],
    style: unique(valid.flatMap(scene => [scene.visual.style, scene.visual.color])),
    rhythm: meaningful(overview.editingRhythm) || unique(valid.map(scene => record(scene.transition.editing).pacing)),
    partial: valid.length < scenes.length,
  };
}
