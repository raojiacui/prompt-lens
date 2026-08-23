CREATE TYPE "public"."credit_ledger_type" AS ENUM('manual_grant', 'payment_grant', 'feature_usage', 'refund_revoke', 'admin_adjustment');--> statement-breakpoint
ALTER TYPE "public"."log_action" ADD VALUE 'admin.credit_grant' BEFORE 'video.edit.start';--> statement-breakpoint
CREATE TABLE "user_credits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_granted" integer DEFAULT 0 NOT NULL,
	"lifetime_used" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" "credit_ledger_type" NOT NULL,
	"package_id" varchar(80),
	"payment_provider" varchar(40),
	"payment_reference" varchar(160),
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_credits_balance" ON "user_credits" USING btree ("balance");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_user_id" ON "credit_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_actor_user_id" ON "credit_ledger" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_type" ON "credit_ledger" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_created_at" ON "credit_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_credit_ledger_payment_reference" ON "credit_ledger" USING btree ("payment_reference");