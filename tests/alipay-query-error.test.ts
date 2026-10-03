import { describe, expect, it } from "vitest";
import { alipayQueryErrorCode } from "@/lib/payments/alipay-query-error";

describe("safe Alipay query diagnostics", () => {
  it("reports a signature failure without exposing the signed payload", () => {
    expect(alipayQueryErrorCode(new Error("验签失败，sign: SECRET, validateStr: BUYER"))).toBe("ALIPAY_SIGNATURE_INVALID");
  });
  it("identifies a retryable timeout", () => {
    expect(alipayQueryErrorCode(new Error("request timeout"))).toBe("ALIPAY_QUERY_TIMEOUT");
  });
  it("does not expose arbitrary provider errors", () => {
    expect(alipayQueryErrorCode(new Error("private details"))).toBe("ALIPAY_QUERY_UNAVAILABLE");
    expect(alipayQueryErrorCode(null)).toBe("ALIPAY_QUERY_UNAVAILABLE");
  });
});
