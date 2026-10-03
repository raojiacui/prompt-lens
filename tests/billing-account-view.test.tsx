import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/payments/alipay-checkout-dialog", () => ({ AlipayCheckoutDialog: () => null }));
import { BillingAccount } from "@/components/payments/billing-account";
import { CreditBalanceLink } from "@/components/workflow/credit-balance-link";

describe("account in the workspace", () => {
  it("embeds the account without another main landmark or workspace back link", () => {
    const html = renderToStaticMarkup(<BillingAccount embedded />);
    expect(html).toContain("账户");
    expect(html).toContain("<section");
    expect(html).not.toContain("<main");
    expect(html).not.toContain('href="/dashboard"');
  });
  it("retains the standalone billing route", () => {
    const html = renderToStaticMarkup(<BillingAccount />);
    expect(html).toContain("<main");
    expect(html).toContain("余额与订单");
  });
  it("uses purchased credits and links to the sidebar account view", () => {
    const html = renderToStaticMarkup(<CreditBalanceLink status={{ balance: 0, commercial: { credits: 200 } }} failed={false} locale="zh" />);
    expect(html).toContain('href="/dashboard?tab=account"');
    expect(html).toContain("200");
  });
});
