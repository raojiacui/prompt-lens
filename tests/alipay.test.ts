import { describe, expect, it } from "vitest";
import { cny, isAlipayPaid, parseCny } from "@/lib/payments/alipay";
import { normalizeAlipayTradeResult } from "@/lib/payments/alipay-reconciliation";

describe("official Alipay payment helpers", () => {
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
