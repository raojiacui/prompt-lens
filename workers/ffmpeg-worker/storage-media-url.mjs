function mediaError(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function configuredStorageMediaUrl(value, { publicUrl, endpoint }) {
  const hosts = [["R2_PUBLIC_URL", publicUrl], ["R2_ENDPOINT", endpoint]].map(([name, configured]) => {
    let url;
    try { url = new URL(configured); } catch {
      throw mediaError(`${name} must be a valid HTTPS storage URL`, "MEDIA_STORAGE_CONFIG_INVALID", 503);
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw mediaError(`${name} must be a valid HTTPS storage URL`, "MEDIA_STORAGE_CONFIG_INVALID", 503);
    }
    return url.hostname;
  });
  let url;
  try {
    if (typeof value !== "string") throw new Error();
    url = new URL(value);
  } catch {
    throw mediaError("A valid video URL is required", "INVALID_MEDIA_URL", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(url.hostname)) {
    throw mediaError("Only configured storage is supported", "INVALID_MEDIA_URL", 400);
  }
  return url;
}
