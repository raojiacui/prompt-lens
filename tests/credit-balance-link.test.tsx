import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreditBalanceLink } from "@/components/workflow/credit-balance-link";

describe("workspace credit balance", () => {
  it("displays package credits with legacy credits separately", () => {
    const html = renderToStaticMarkup(<CreditBalanceLink status={{ balance: 25, commercial: { credits: 600 } }} failed={false} locale="zh" />);
    expect(html).toContain("600");
    expect(html).toContain("原版积分");
    expect(html).toContain("25");
    expect(html).toContain('href="/billing"');
  });
  it("preserves zero package balances rather than falling back to legacy", () => {
    const html = renderToStaticMarkup(<CreditBalanceLink status={{ balance: 25, commercial: { credits: 0 } }} failed={false} locale="en" />);
    expect(html).toContain("Credit balance: 0");
    expect(html).toContain("Legacy credits");
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it("does not invent a zero balance while loading or after errors", () => {
    expect(renderToStaticMarkup(<CreditBalanceLink status={null} failed={false} locale="zh" />)).toContain("加载中");
    expect(renderToStaticMarkup(<CreditBalanceLink status={{ balance: 123 }} failed locale="zh" />)).toContain("暂不可用");
  });
  it("shows reserved credits separately from the spendable balance", () => {
    const html = renderToStaticMarkup(<CreditBalanceLink status={{ balance: 0, commercial: { credits: 400, heldCredits: 200 } }} failed={false} locale="zh" />);
    expect(html).toContain("积分余额: 400");
    expect(html).toContain("任务预留: 200");
  });
});
