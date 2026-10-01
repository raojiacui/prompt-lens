import { describe, expect, it } from "vitest";
import { cny, isAlipayPaid, parseCny } from "@/lib/payments/alipay";
import { normalizeAlipayTradeResult } from "@/lib/payments/alipay-reconciliation";
import { alipayOrderDeadline, alipayExpiryTimestamp } from "@/lib/payments/order-expiry";

describe("official Alipay payment helpers", () => {
  it("sets a fixed 15-minute deadline and formats it in Alipay's China timezone", () => {
    const deadline = alipayOrderDeadline(new Date("2026-10-01T16:55:00Z"));
    expect(deadline.toISOString()).toBe("2026-10-01T17:10:00.000Z");
    expect(alipayExpiryTimestamp(deadline)).toBe("2026-10-02 01:10:00");
  });
  it("converts money without floating-point comparisons", () => {
    expect(cny(1990)).toBe("19.90");
    expect(parseCny("19.9")).toBe(1990);
    expect(parseCny("19.901")).toBeNull();
  });

  it("accepts SDK camelCase query results", () => {
    expect(normalizeAlipayTradeResult({ appId: "app", outTradeNo: "order", tradeNo: "trade", tradeStatus: "TRADE_SUCCESS", totalAmount: "19.90", sellerId: "seller" })).toEqual({
      app_id: "app", out_trade_no: "order", trade_no: "trade", trade_status: "TRADE_SUCCESS", total_amount: "19.90", seller_id: "seller",
    });
  });

  it("does not treat refund notifications as a paid event", () => {
    expect(isAlipayPaid({ trade_status: "TRADE_SUCCESS" })).toBe(true);
    expect(isAlipayPaid({ trade_status: "TRADE_SUCCESS", refund_fee: "19.90" })).toBe(false);
    expect(isAlipayPaid({ trade_status: "WAIT_BUYER_PAY" })).toBe(false);
  });
});
