CREATE TYPE "public"."payment_provider" AS ENUM('creem', 'xunhupay', 'manual_qr');--> statement-breakpoint
CREATE TYPE "public"."payment_order_status" AS ENUM('pending', 'paid', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_order_id" varchar(160) NOT NULL,
	"checkout_id" varchar(160),
	"package_id" varchar(80) NOT NULL,
	"package_name" text NOT NULL,
	"credits" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(10) NOT NULL,
	"status" "payment_order_status" DEFAULT 'pending' NOT NULL,
	"checkout_url" text,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_orders_user_id" ON "payment_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_provider" ON "payment_orders" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_status" ON "payment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_package_id" ON "payment_orders" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_orders_provider_order_unique" ON "payment_orders" USING btree ("provider", "provider_order_id");