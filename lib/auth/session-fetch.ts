import { ACCESS_SESSION_REFRESH_REQUIRED } from "./session-cookies";

let refreshInFlight: Promise<Response> | null = null;

function refreshAccessSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/session-refresh", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000),
    }).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function fetchWithSessionRefresh(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401 || !input.startsWith("/api/") || input.startsWith("/api/auth/") || input.startsWith("/api/session-refresh")
    || (init?.body != null && typeof init.body !== "string")) return response;
  const error = await response.clone().json().catch(() => null);
  // This marker proves middleware rejected the request before business logic.
  // Never replay generic 401s, network failures or unknown paid submissions.
  if (error?.code !== ACCESS_SESSION_REFRESH_REQUIRED) return response;
  init?.signal?.throwIfAborted();
  let refreshed: Response;
  try { refreshed = await refreshAccessSession(); }
  catch { return Response.json({ code: "SESSION_REFRESH_UNAVAILABLE" }, { status: 503 }); }
  init?.signal?.throwIfAborted();
  if (!refreshed.ok) return refreshed.clone();
  return fetch(input, init); // At most one replay; keep the same task ID and body.
}
