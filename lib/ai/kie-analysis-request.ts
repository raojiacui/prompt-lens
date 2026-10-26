import { getKieAnalysisPath } from "@/lib/ai/analysis-models";

export function buildKieAnalysisRequest(model: string, frames: string[], prompt: string) {
  const path = getKieAnalysisPath(model);
  const payload: Record<string, unknown> = model === "deepseek-v4-1-flash"
    ? {
      model,
      reasoning: { effort: "none" },
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...frames.map((image_url) => ({ type: "input_image", image_url })),
        ],
      }],
    }
    : {
      model,
      max_tokens: 8192,
      include_thoughts: false,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...frames.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      }],
    };
  return { path, payload };
}
