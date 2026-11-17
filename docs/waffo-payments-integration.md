# Waffo Pancake Payments — isolated sandbox integration

Status: sandbox checkout transport and test webhook signature verification are implemented. **Production charging, order fulfillment, refunds, and wallet credits are NOT integrated yet.** No checkout buttons were enabled.

## Current scaffold
- `lib/payments/waffo-client.ts`: server-only RSA-SHA256 signed requests to Waffo's token and checkout-session endpoints, fixed product mapping, server-derived priceSnapshot, idempotency key.
- `POST /api/payments/waffo/sandbox-checkout`: authenticated + same-origin check; accepts existing package ID and UUID request ID only; server determines price and customer identity.
- `POST /api/payments/waffo/webhook`: validates test webhook signature and 45-min past / 1-min future replay window, rejects production; **no credit grant**.
- Both endpoints disabled by default and never operable in Vercel production.

## Preview-only server configuration
```text
WAFFO_SANDBOX_CHECKOUT_ENABLED=false
WAFFO_MERCHANT_ID=MER_...  # Waffo test merchant
WAFFO_PRIVATE_KEY=<Waffo TEST RSA PEM private key>
WAFFO_WEBHOOK_TEST_PUBLIC_KEY=<documented TEST webhook verification public key>
WAFFO_TEST_PRODUCT_V6_TRIAL_200=PROD_...
WAFFO_TEST_PRODUCT_V6_CREATOR_650=PROD_...
WAFFO_TEST_PRODUCT_V6_VOLUME_1500=PROD_...
```
Confirm that each test product supports CNY and has the matching displayed price: CNY 34.90 / 89.90 / 199.00. If CNY is unsupported, explicitly design a separate exchange-rate snapshot and published currency display instead of silently mixing CNY and USD. The user currently has created only one Pancake product; all product IDs must be confirmed separately.

## Production blockers — DO NOT enable before completing
1. Design and migrate a `waffo` payment provider in `payment_orders`, with immutable SKU, amount, currency, environment and unique local order reference.
2. Persist pending orders BEFORE checkout and bind `orderMerchantExternalId` to the exact local order. Reuse the reference on retries.
3. Verify Waffo's webhook signature, expected environment and store, unique event ID, order identity, product, currency, effective paid amount and payment success. Fulfill exactly once in a DB transaction. Browser success redirect is **not** proof of payment.
4. Handle failure/refund/chargeback and freeze or reconcile wallet credits; preserve existing commercial lot semantics.
5. Test webhook duplicates, out-of-order events, replay, amount mismatch, transaction rollback and partial/unknown outcomes; test refund and dispute processes.
6. Add proper UI and localized checkout state once Waffo account is approved; keep other provider paths isolated.
7. Add a dedicated `WAFFO_PAYMENTS_ENABLED` production gate only after the complete launch review.

## Documentation basis
Waffo Pancake TypeScript SDK: https://github.com/waffo-com/waffo-pancake-sdk-ts
SDK supports authenticated sessions (session token + checkout URL), signed requests and signed webhooks. For deployment readiness prefer the official SDK once lockfile can be regenerated and audited.
