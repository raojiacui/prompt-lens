import crypto from "crypto";

export function createXunhuPayHash(data: Record<string, unknown>, secret: string) {
  const base = Object.keys(data).sort()
    .filter((key) => key !== "hash" && data[key] !== null && data[key] !== undefined && data[key] !== "")
    .map((key) => `${key}=${String(data[key])}`).join("&");
  return crypto.createHash("md5").update(`${base}${secret}`, "utf8").digest("hex");
}

export function verifyXunhuPayHash(data: Record<string, unknown>, secret: string) {
  if (!secret || typeof data.hash !== "string" || !/^[a-f0-9]{32}$/i.test(data.hash)) return false;
  return crypto.timingSafeEqual(Buffer.from(createXunhuPayHash(data, secret), "hex"), Buffer.from(data.hash, "hex"));
}

export function parseCnyCents(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) throw new Error("Invalid payment amount");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Invalid payment amount");
  return cents;
}

export function assertXunhuPayOrderMatch(order: { amountCents: number; currency: string; metadata: unknown }, payload: Record<string, unknown>) {
  const metadata = order.metadata as { appId?: string } | null;
  if (!metadata?.appId || payload.appid !== metadata.appId) throw new Error("Payment app mismatch");
  if (order.currency.toLowerCase() !== "cny" || parseCnyCents(payload.total_fee) !== order.amountCents) throw new Error("Payment amount mismatch");
  if (payload.status !== "OD") throw new Error("Payment is not paid");
}
