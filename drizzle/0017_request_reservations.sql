CREATE TABLE "trial_analysis_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "task_key" text NOT NULL,
  "state" varchar(20) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'released')),
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trial_reservation_task_unique" ON "trial_analysis_reservations" ("user_id", "task_key");
--> statement-breakpoint
CREATE INDEX "trial_reservation_expiry_idx" ON "trial_analysis_reservations" ("state", "expires_at");
--> statement-breakpoint
CREATE TABLE "api_rate_limits" (
  "key" text PRIMARY KEY,
  "count" integer NOT NULL,
  "reset_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_rate_limit_expiry_idx" ON "api_rate_limits" ("reset_at");
