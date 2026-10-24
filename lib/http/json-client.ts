type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function getErrorDetail(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (!data || typeof data !== "object") return null;

  const body = data as Record<string, unknown>;
  if (typeof body.message === "string") return body.message;
  if (typeof body.msg === "string") return body.msg;

  if (body.error && typeof body.error === "object") {
    const nested = body.error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }

  return null;
}

export class JsonHttpError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown, statusText = "") {
    const detail = getErrorDetail(data);
    const suffix = detail || statusText || "Request failed";
    super(`HTTP ${status}: ${suffix}`);
    this.name = "JsonHttpError";
    this.status = status;
    this.data = data;
  }
}

export function isJsonHttpError(error: unknown): error is JsonHttpError {
  return error instanceof JsonHttpError;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  return JSON.parse(text);
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<T> {
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const text = await response.text();
  let data: unknown;

  try {
    data = parseJson(text);
  } catch {
    if (!response.ok) {
      throw new JsonHttpError(response.status, text, response.statusText);
    }
    throw new Error(`HTTP endpoint returned invalid JSON (${response.status})`);
  }

  if (!response.ok) {
    throw new JsonHttpError(response.status, data, response.statusText);
  }

  return data as T;
}
