import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceivedGifts, type ReceivedGift } from "@/components/payments/received-gifts";
const gift: ReceivedGift = { id: "gift", credits: 200, rewrites: 20, linkImports: 12, note: "朋友体验，欢迎反馈",
  createdAt: "2026-11-23T00:00:00Z", expiresAt: "2099-12-30T00:00:00Z", availableCredits: 180, availableRewrites: 19 };
describe("recipient gift provenance", () => {
  it("clearly shows the source, public note, all benefits and expiry", () => {
    const html = renderToStaticMarkup(<ReceivedGifts gifts={[gift]} zh />);
    for (const value of ["管理员赠送", "朋友体验，欢迎反馈", "200", "20", "12", "发放时间", "到期时间", "180", "19"]) expect(html).toContain(value);
  });
  it("renders notes as text without executing markup", () => {
    const html = renderToStaticMarkup(<ReceivedGifts gifts={[{ ...gift, note: '<script>alert("gift")</script>' }]} zh />);
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
  it("marks expired gifts unavailable and does not invent a missing reason", () => {
    const html = renderToStaticMarkup(<ReceivedGifts gifts={[{ ...gift, expiresAt: "2000-01-01T00:00:00Z", note: "" }]} zh />);
    expect(html).toContain("已到期"); expect(html).toContain("管理员未填写备注"); expect(html).not.toContain(">180 ");
  });
  it("supports English and keeps the section absent for users without gifts", () => {
    expect(renderToStaticMarkup(<ReceivedGifts gifts={[gift]} zh={false} />)).toContain("Gifted by an administrator");
    expect(renderToStaticMarkup(<ReceivedGifts gifts={[]} zh />)).toBe("");
  });
});
