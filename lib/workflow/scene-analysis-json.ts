import { InvalidSceneAnalysisResult, validateSceneAnalysis } from "./scene-analysis-result";

// A provider may return a failed draft followed by a corrected JSON document
// in one completed answer. Recover only a complete, unambiguous valid result.
export function parseSceneAnalysisJson(raw: string): Record<string, unknown> {
  if (raw.length > 2_000_000) throw new InvalidSceneAnalysisResult("Scene analysis response too large");
  const results: Record<string, unknown>[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false, count = 0;
  let lastFailure: unknown;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (start < 0) {
      if (char !== "{") continue;
      start = i; depth = 1; quoted = false; escaped = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      if (++count > 10) throw new InvalidSceneAnalysisResult("Too many scene analysis documents");
      try {
        const candidate: unknown = JSON.parse(raw.slice(start, i + 1));
        validateSceneAnalysis(candidate);
        results.push(candidate);
      } catch (error) { lastFailure = error; }
      start = -1;
    }
  }
  if (start >= 0) throw new InvalidSceneAnalysisResult("Incomplete trailing scene analysis document");
  if (!results.length) {
    if (lastFailure instanceof InvalidSceneAnalysisResult) throw lastFailure;
    throw new InvalidSceneAnalysisResult("AI provider returned invalid JSON scene analysis");
  }
  const distinct = new Set(results.map(result => JSON.stringify(result)));
  if (distinct.size > 1) throw new InvalidSceneAnalysisResult("Ambiguous multiple valid scene analyses");
  return results[results.length - 1];
}
