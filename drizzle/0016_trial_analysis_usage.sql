CREATE TABLE IF NOT EXISTS "trial_analysis_usage" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "used" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trial_analysis_usage_used_nonnegative" CHECK ("used" >= 0)
);
