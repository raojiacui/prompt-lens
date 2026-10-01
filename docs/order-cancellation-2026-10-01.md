# Unpaid order cancellation

New Alipay orders expire 15 minutes after their local creation time, not 15
minutes after each visit to checkout. The payment form passes an absolute
`time_expire` in Asia/Shanghai time. Returning to checkout cannot extend it.
Expired or cancellation-requested orders cannot issue another payment form.

Both the payment dialog and /billing expose a deliberate cancellation action.
Cancellation is not a refund and never calls the refund gateway. The server
requires the owner session and same-origin POST, then queries Alipay first.
Verified paid results grant the purchase normally; verified unpaid results are
closed through Alipay before local status becomes cancelled. Closed provider
transactions also become cancelled. Unknown queries/close responses remain
pending and are retried by polling or the existing reconciliation scheduler.

A form-issuance marker and atomic cancellation flag prevent a missing provider
trade from being cancelled while an already issued form could still collect
money. A new-version order with no issued form can be cancelled immediately
after a verified missing-trade response. An issued form must reach its gateway
deadline first, unless Alipay confirms closure. Legacy orders without the
deadline version are not assumed safe merely because a trade is missing.

The scheduled reconciliation endpoint now checks up to 20 pending orders per
run, including older unresolved records. It shares the same 15-minute rule as
interactive status queries. The existing external worker/scheduler must remain
running after deployment. Local order status catches up on the next query or
scheduler run; a network outage remains visibly unconfirmed instead of being
reported as a successful cancellation.

Cancelled order records are retained for audit, with no credit grant. Tests use
isolated databases and mocked Alipay responses; live gateway deadline/close
behavior still needs sandbox acceptance before production release. No database
migration or new environment variable is introduced.

Official API references:
- https://opendocs.alipay.com/apis/api_1/alipay.trade.page.pay
- https://developer.alibaba.com/docs/doc.htm?articleId=105901&docType=1&treeId=237
