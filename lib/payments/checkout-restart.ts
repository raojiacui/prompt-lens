export function shouldRestartCheckout(order: { status: string; expiresAt: string }, _now = Date.now()) {
  // Expiry alone is not proof of non-payment. Reconcile before replacing it.
  return ["paid", "cancelled", "failed", "refunded"].includes(order.status);
}
