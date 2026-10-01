# Payment Reconciliation Hardening

## Changes

- All four synchronous Alipay operations (trade query, trade close, refund, refund query) require SDK response signature validation. A missing provider public key prevents the request.
- Refund query success requires code `10000`, matching `out_trade_no`, matching `out_request_no`, the exact order amount in `refund_amount`, and `REFUND_SUCCESS`. Camel-case SDK responses and snake-case responses are supported.
- Admin `query_refund` only queries an already approved refund in `processing` or `review`. It never calls the refund submission API. Missing records, rejected signatures, mismatched receipts and network errors remain under review; benefits stay paused.
- A confirmed refund updates refund, order and purchase-lot states atomically. Repeated or concurrent queries cannot regress a successful refund or restore refunded benefits. Query reviewer identity and time are stored separately from original approval evidence.
- Checkout creation, request replay and order retrieval return saved price and benefits. The dialog waits for that snapshot rather than displaying the current catalog price for an old order.

## Operator Flow

Customer request -> support conversation -> explicit admin approval -> one refund submission.

If submission is uncertain, open `/billing/review` and select the existing refund's query action. This is not a second approval or refund request. A still-unconfirmed result needs further merchant-record review, not another submission. An unapproved or declined request cannot use the query action to become a successful refund.

## Acceptance Boundary

Verified locally: 303 unit/integration tests, 28 desktop/mobile browser tests, TypeScript checking and a production build passed. Browser fixtures cover saved-price checkout, manual approval, read-only refund queries and unpaid-order cancellation. Browser test artifacts use a separate ignored output directory to avoid sharing development caches.

Automated tests use isolated databases and mocked gateway calls. No real payment, refund, production database change or deployment is performed. After deployment, a separately authorized sandbox/live acceptance test is still needed to verify actual gateway signatures and merchant credentials.

Official refund-query reference: https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/api-list/alipay-trade-fastpay-refund-query.html
