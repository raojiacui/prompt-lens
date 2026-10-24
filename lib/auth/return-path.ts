export function authReturnPath(value: string | null | undefined): string {
  const fallback = "/dashboard";
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://auth-return.invalid");
    if (url.pathname === "/login" || url.pathname === "/api/session-refresh") return fallback;
    url.searchParams.delete("__pl_access_refreshed");
    url.searchParams.delete("sessionRefreshFailed");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
