const DEFAULT_SITE_URL = "https://prompt-lens.cc.cd";

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  try {
    const url = new URL(value || fallback);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.href.replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function getEmailRuntimeConfig() {
  const siteUrl = normalizeBaseUrl(
    process.env.EMAIL_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    DEFAULT_SITE_URL,
  );
  const assetBaseUrl = normalizeBaseUrl(process.env.EMAIL_ASSET_BASE_URL, siteUrl);

  return {
    siteUrl,
    iconUrl: process.env.EMAIL_ASSET_BASE_URL
      ? `${assetBaseUrl}/email/prompt-lens-icon.png`
      : `${assetBaseUrl}/prompt-lens-icon.png`,
    heroUrl: process.env.EMAIL_ASSET_BASE_URL
      ? `${assetBaseUrl}/email/hero-text-fishing.jpg`
      : `${assetBaseUrl}/images/hero-text-fishing.jpg`,
  };
}
