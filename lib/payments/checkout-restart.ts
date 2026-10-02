export function shouldRestartCheckout(order: { status: string; expiresAt: string }, now = Date.now()) {
  if (["cancelled", "failed", "refunded"].includes(order.status)) return true;
  const deadline = Date.parse(order.expiresAt);
  return order.status === "pending" && Number.isFinite(deadline) && deadline <= now;
}
