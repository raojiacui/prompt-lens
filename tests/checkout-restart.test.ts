import { describe, expect, it } from "vitest";
import { shouldRestartCheckout } from "@/lib/payments/checkout-restart";

const now = Date.parse("2026-10-02T13:00:00Z");
describe("restarting a saved checkout", () => {
  it("reconciles expired pending orders before allowing another payment", () => {
    expect(shouldRestartCheckout({ status: "pending", expiresAt: new Date(now).toISOString() }, now)).toBe(false);
  });
  it("keeps an unexpired request to avoid duplicate orders", () => {
    expect(shouldRestartCheckout({ status: "pending", expiresAt: new Date(now + 1).toISOString() }, now)).toBe(false);
  });
  it.each(["paid", "cancelled", "failed", "refunded"])("starts fresh after %s", (status) => {
    expect(shouldRestartCheckout({ status, expiresAt: new Date(now + 60000).toISOString() }, now)).toBe(true);
  });
  it.each(["unknown"])("does not restart %s orders", (status) => {
    expect(shouldRestartCheckout({ status, expiresAt: new Date(now - 60000).toISOString() }, now)).toBe(false);
  });
  it("does not use malformed deadlines as a reason to create another order", () => {
    expect(shouldRestartCheckout({ status: "pending", expiresAt: "invalid" }, now)).toBe(false);
  });
});
