export function shouldRestartCheckout(order: { status: string; expiresAt: string; cancellationRequested?: boolean }, _now = Date.now()) {
  // Expiry alone is not proof of non-payment. Reconcile before replacing it.
  return order.cancellationRequested === true || ["paid", "cancelled", "failed", "refunded"].includes(order.status);
}
