-- Apply to the isolated test database first; production requires a separate release.
ALTER TYPE "payment_provider" ADD VALUE IF NOT EXISTS 'waffo';
--> statement-breakpoint
CREATE TABLE "waffo_payment_events" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "event_id" varchar(160) NOT NULL,
 "environment" varchar(8) NOT NULL CHECK ("environment" IN ('test','prod')),
 "store_id" varchar(80) NOT NULL,
 "order_id" uuid NOT NULL REFERENCES "payment_orders"("id"),
 "event_type" varchar(80) NOT NULL,
 "payload_hash" varchar(64) NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "waffo_payment_event_unique" ON "waffo_payment_events" ("environment","store_id","event_id");
CREATE INDEX "waffo_payment_event_order" ON "waffo_payment_events" ("order_id");
ALTER TABLE "waffo_payment_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "waffo_payment_events" FROM PUBLIC, anon, authenticated;
