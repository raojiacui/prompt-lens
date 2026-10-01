type PromptScene = { generationPrompt: string; visual: Record<string, unknown>; metadata?: Record<string, unknown> | null };

function detail(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(detail).filter(Boolean).join("; ");
  if (value && typeof value === "object") return Object.values(value).map(detail).filter(Boolean).join("; ");
  return "";
}

/** Preserve visual constraints in the text actually copied or sent to a generation model. */
export function buildRecreationPrompt(scene: PromptScene) {
  const prompt = scene.generationPrompt.trim();
  if (!prompt || scene.metadata?.analysisProvider === "fallback" || scene.metadata?.recreationPromptVersion === 1) return prompt;
  const zh = /[\u4e00-\u9fff]/.test(prompt);
  const groups = [
    [zh ? "画面与环境" : "Scene and environment", ["sceneDescription", "subject", "environment"]],
    [zh ? "人物与动作" : "Characters and action", ["characters", "action", "motion"]],
    [zh ? "镜头与构图" : "Camera and composition", ["camera", "composition"]],
    [zh ? "光影与质感" : "Lighting and style", ["lighting", "color", "style"]],
  ] as const;
  const seen = new Set<string>();
  const additions = groups.flatMap(([label, keys]) => {
    const values = keys.map((key) => detail(scene.visual[key])).filter((value) => {
      if (!value || prompt.includes(value) || seen.has(value)) return false;
      seen.add(value); return true;
    });
    return values.length ? [`${label}: ${values.join(zh ? "；" : "; ")}`] : [];
  });
  return [prompt, ...additions].join("\n\n");
}
