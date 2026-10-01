export const ALIPAY_ORDER_LIFETIME_MS = 15 * 60 * 1000;
export const ALIPAY_EXPIRY_VERSION = "15m_v1";

export function alipayOrderDeadline(createdAt: Date) {
  return new Date(createdAt.getTime() + ALIPAY_ORDER_LIFETIME_MS);
}

export function alipayExpiryTimestamp(deadline: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(deadline);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
