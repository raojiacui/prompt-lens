# V2 package price update

The approved launch prices are CNY 21.90 / 63.90 / 139.00 for
200 / 650 / 1500 credits, with 20 / 60 / 150 included rewrites.
Analysis and splitting credit rates are unchanged. Historical order amounts
remain immutable; new checkout requests use the package catalog price.

The increase budgets for EasyDown one-time Starter credits (USD 9 / 500).
At the existing budget exchange rate of CNY 7.50/USD with 20% contingency,
one charged Douyin, TikTok or Bilibili parse budgets CNY 0.162.
Source: https://easydown.org/pricing (checked 2026-10-01).

The user approved 12 / 30 / 61 included link parsing attempts per package.
New purchase grants snapshot this allowance in the purchase ledger. Active
purchase lots contribute allowances; historical grants without the snapshot
do not automatically receive new benefits. Purchases accumulate allowances.
Each new import reservation consumes one attempt, including failed attempts.
Retries of the same request reuse the reservation without another provider
call. Wallet row locking prevents concurrent calls from exceeding allowances.
Imports charge zero general credits. Splitting and analysis keep their rates.
Using an import allowance makes that purchase ineligible for automatic refund.
There is no additional database schema migration for this change.

This document supersedes the historical package prices and import charge in
link-import-cost-and-allowance-2026-09-27.md. Not deployed to production yet.
