type CompactSessionCache = {
  session: {
    session?: { expiresAt?: unknown };
    user?: { email?: unknown };
    [key: string]: unknown;
  };
  expiresAt: number;
  signature: string;
};

const CACHE_COOKIE_NAMES = [
  "__Secure-better-auth.session_data",
  "better-auth.session_data",
];

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function readChunkedCookie(cookies: Map<string, string>, baseName: string) {
  const complete = cookies.get(baseName);
  if (complete) return complete;

  const chunks: Array<{ index: number; value: string }> = [];
  for (const [name, value] of cookies) {
    if (!name.startsWith(`${baseName}.`)) continue;
    const index = Number.parseInt(name.slice(baseName.length + 1), 10);
    if (Number.isInteger(index) && index >= 0) chunks.push({ index, value });
  }

  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.index - b.index);
  return chunks.map((chunk) => chunk.value).join("");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function parseCompactCache(value: string): CompactSessionCache | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Partial<CompactSessionCache>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.session || typeof parsed.session !== "object") return null;
    if (typeof parsed.expiresAt !== "number" || typeof parsed.signature !== "string") return null;
    return parsed as CompactSessionCache;
  } catch {
    return null;
  }
}

function sessionIsExpired(cache: CompactSessionCache) {
  if (cache.expiresAt < Date.now()) return true;
  const sessionExpiry = cache.session.session?.expiresAt;
  if (typeof sessionExpiry !== "string" && typeof sessionExpiry !== "number") return false;
  const timestamp = new Date(sessionExpiry).getTime();
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

async function hasValidSignature(cache: CompactSessionCache, secret: string) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signedValue = JSON.stringify({
      ...cache.session,
      expiresAt: cache.expiresAt,
    });
    return crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(cache.signature),
      new TextEncoder().encode(signedValue),
    );
  } catch {
    return false;
  }
}

export async function verifiedCachedSessionEmail(
  request: Request | Headers,
  secret: string,
): Promise<string | null> {
  const headers = request instanceof Headers ? request : request.headers;
  const cookies = parseCookies(headers.get("cookie"));
  const encoded = CACHE_COOKIE_NAMES
    .map((name) => readChunkedCookie(cookies, name))
    .find((value): value is string => Boolean(value));

  if (!encoded) return null;
  const cache = parseCompactCache(encoded);
  if (!cache || sessionIsExpired(cache) || !(await hasValidSignature(cache, secret))) return null;
  const email = cache.session.user?.email;
  return typeof email === "string" ? email : null;
}
