import { describe, expect, it } from "vitest";
import { assertXunhuPayOrderMatch, createXunhuPayHash, parseCnyCents, verifyXunhuPayHash } from "@/lib/payments/xunhupay-signature";

describe("Xunhupay payment verification", () => {
  it("signs sorted fields including zero, excluding empty fields and hash", () => {
    expect(createXunhuPayHash({ b: 0, a: "hello", empty: "", hash: "old" }, "secret")).toBe(createXunhuPayHash({ a: "hello", b: 0 }, "secret"));
  });
  it("rejects tampered and malformed signatures", () => {
    const data = { appid: "test", total_fee: "19.90", status: "OD" };
    const hash = createXunhuPayHash(data, "secret");
    expect(verifyXunhuPayHash({ ...data, hash }, "secret")).toBe(true);
    expect(verifyXunhuPayHash({ ...data, total_fee: "1.00", hash }, "secret")).toBe(false);
    for (const bad of [hash + "xx", hash.slice(0, -1), "", "g".repeat(32)]) expect(verifyXunhuPayHash({ ...data, hash: bad }, "secret")).toBe(false);
    expect(verifyXunhuPayHash({ ...data, hash }, "")).toBe(false);
  });
  it.each([["19.9", 1990], ["59", 5900], ["129.00", 12900], ["0.01", 1]])("parses %s without floating point currency arithmetic", (value, cents) => {
    expect(parseCnyCents(value)).toBe(cents);
  });
  it.each(["0", "-1", "1e2", "1.001", " 19.9", "NaN", 19.9])("rejects invalid money %s", (value) => expect(() => parseCnyCents(value)).toThrow());
  it("requires the exact order amount, app and paid status", () => {
    const order = { amountCents: 1990, currency: "cny", metadata: { appId: "ali" } };
    const payload = { total_fee: "19.90", appid: "ali", status: "OD" };
    expect(() => assertXunhuPayOrderMatch(order, payload)).not.toThrow();
    for (const override of [{ total_fee: "1.00" }, { appid: "other" }, { status: "CD" }]) expect(() => assertXunhuPayOrderMatch(order, { ...payload, ...override })).toThrow();
  });
});
