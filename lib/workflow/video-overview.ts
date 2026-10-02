type OverviewScene = {
  sceneIndex: number;
  story: Record<string, unknown>;
  visual: Record<string, unknown>;
  transition: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const templateDescriptions = new Set([
  "Describe every visible element in the frame precisely enough for text-to-video recreation",
  "Describe cut speed, beat placement, and whether this is a fast cut, normal cut, or held shot",
  "Describe visible zoom, pan, scale, opacity, or position keyframes if present",
  "Reference-video style, realism level, texture, format, platform aesthetic, and production quality",
  "Dominant palette, saturation, contrast, color temperature, skin/object tones, and grading style",
  "Primary visible subject from the reference scene",
  "Main action, gesture sequence, object interaction, and motion direction visible in this segment",
  "Shot size, lens feel, angle, height, movement path, motion speed, focus behavior, and framing",
  "Subject motion, camera motion, background motion, speed changes, and continuity constraints",
  "Light source, direction, softness, contrast, exposure, shadow shape, highlights, and time feeling",
  "Characters, appearance, wardrobe, expression, pose, and relationship to each other",
  "Subject placement, foreground/midground/background, negative space, symmetry, depth, and occlusion",
  "Location, background layers, props, time of day, weather, and set details inferred from the keyframe",
  "Preserve the original rhythm unless the remix changes it",
  "Preserve original edit timing and scene duration",
  "Use extracted audio as timing reference",
  "N/A", "None", "Unknown", "Placeholder", "待分析", "未分析", "暂无分析", "暂无内容",
].map(value => value.toLowerCase()));

const workflowPlaceholder = /Reference-driven|editable scene blueprint|Scene-level structure|Follow detected scene boundaries|Use extracted audio cues|Use the first scene|生成前需要|保留原始时长|保留原始剪辑|Selected analysis provider/i;
const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

function meaningful(value: unknown): string {
  if (typeof value !== "string") return "";
  // Filter individual sentences so mixed fields retain their actual video descriptions.
  return value.split(/\r?\n/).map(line => [...sentences.segment(line)]
    .map(({ segment }) => segment.trim())
    .filter(text => text && !workflowPlaceholder.test(text) &&
      !templateDescriptions.has(text.toLowerCase().replace(/[.。!！]+$/u, "").trim()))
    .join(" "))
    .filter(Boolean).join("\n");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readableVideoOverview(overview: Record<string, unknown>, scenes: OverviewScene[]) {
  const valid = [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex).filter(scene => scene.metadata?.analysisProvider !== "fallback");
  const nested = record(overview.video_summary || overview.videoSummary || overview.summary);
  const narrative = [overview.narrative, typeof overview.summary === "string" ? overview.summary : null, nested.summary, nested.narrative].map(meaningful).find(Boolean);
  const paragraphs = narrative ? [narrative] : valid.map(scene => meaningful(scene.story.summary) || meaningful(scene.story.sceneDescription) || meaningful(scene.visual.sceneDescription)).filter(Boolean);
  const unique = (values: unknown[]) => [...new Set(values.map(meaningful).filter(Boolean))].slice(0, 3).join(" ");
  return {
    paragraphs: [...new Set(paragraphs)],
    style: unique(valid.flatMap(scene => [scene.visual.style, scene.visual.color])),
    rhythm: meaningful(overview.editingRhythm) || unique(valid.map(scene => record(scene.transition.editing).pacing)),
    partial: valid.length < scenes.length,
  };
}
