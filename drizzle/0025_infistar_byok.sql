ALTER TYPE "api_provider" ADD VALUE IF NOT EXISTS 'infistar';
--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD COLUMN "is_preferred" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_api_keys_one_preferred" ON "user_api_keys" ("user_id") WHERE "is_preferred" = true;
