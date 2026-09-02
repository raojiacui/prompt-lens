export type MusicRecognitionStatus = "disabled" | "recognized" | "not_found" | "error";

export type BackgroundMusicRecognition = {
  provider: "audd";
  status: MusicRecognitionStatus;
  sourceUrl?: string;
  recognizedAt?: string;
  title?: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  label?: string;
  songLink?: string;
  appleMusicUrl?: string;
  spotifyUrl?: string;
  timecode?: string;
  error?: string;
  raw?: Record<string, unknown>;
};

function readNestedString(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function normalizeAudDResult(payload: Record<string, unknown>, sourceUrl: string): BackgroundMusicRecognition {
  const result = payload.result && typeof payload.result === "object"
    ? payload.result as Record<string, unknown>
    : null;

  if (!result) {
    return {
      provider: "audd",
      status: "not_found",
      sourceUrl,
      recognizedAt: new Date().toISOString(),
      raw: payload,
    };
  }

  return {
    provider: "audd",
    status: "recognized",
    sourceUrl,
    recognizedAt: new Date().toISOString(),
    title: readNestedString(result, ["title"]),
    artist: readNestedString(result, ["artist"]),
    album: readNestedString(result, ["album"]),
    releaseDate: readNestedString(result, ["release_date"]),
    label: readNestedString(result, ["label"]),
    songLink: readNestedString(result, ["song_link"]),
    appleMusicUrl: readNestedString(result, ["apple_music", "url"]),
    spotifyUrl: readNestedString(result, ["spotify", "external_urls", "spotify"]),
    timecode: readNestedString(result, ["timecode"]),
    raw: result,
  };
}

export async function recognizeBackgroundMusic(sourceUrl?: string): Promise<BackgroundMusicRecognition> {
  const apiToken = process.env.AUDD_API_TOKEN?.trim();
  if (!apiToken) {
    return { provider: "audd", status: "disabled", error: "AUDD_API_TOKEN is not configured" };
  }
  if (!sourceUrl) {
    return { provider: "audd", status: "error", error: "No audio URL available for music recognition" };
  }

  const formData = new FormData();
  formData.append("api_token", apiToken);
  formData.append("url", sourceUrl);
  formData.append("return", "apple_music,spotify");

  try {
    const response = await fetch("https://api.audd.io/", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        provider: "audd",
        status: "error",
        sourceUrl,
        error: payload?.error?.error_message || payload?.error || `AudD request failed with ${response.status}`,
      };
    }
    if (!payload || typeof payload !== "object") {
      return { provider: "audd", status: "error", sourceUrl, error: "AudD returned an invalid response" };
    }
    const record = payload as Record<string, unknown>;
    if (record.status && record.status !== "success") {
      return {
        provider: "audd",
        status: "error",
        sourceUrl,
        error: readNestedString(record, ["error", "error_message"]) || readNestedString(record, ["error"]) || "AudD recognition failed",
        raw: record,
      };
    }
    return normalizeAudDResult(record, sourceUrl);
  } catch (error) {
    return {
      provider: "audd",
      status: "error",
      sourceUrl,
      error: error instanceof Error ? error.message : "AudD recognition failed",
    };
  }
}
