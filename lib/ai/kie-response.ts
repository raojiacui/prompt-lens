export function getKieResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const choices = data.choices;
  if (Array.isArray(choices)) {
    const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
    if (typeof message?.content === "string" && message.content.trim()) return message.content;
    if (Array.isArray(message?.content)) {
      const text = message.content.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "").join("");
      if (text.trim()) return text;
    }
  }
  const candidates = data.candidates;
  if (Array.isArray(candidates)) {
    const parts = (candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } } | undefined)?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts.map((part) => typeof part.text === "string" ? part.text : "").join("");
      if (text.trim()) return text;
    }
  }
  return null;
}
