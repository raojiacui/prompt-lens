CREATE TABLE "media_cleanup_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "storage_key" text NOT NULL UNIQUE,
  "state" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "media_cleanup_jobs_state_check" CHECK (state IN ('pending','working','deleted'))
);
--> statement-breakpoint
CREATE INDEX "media_cleanup_jobs_pending_idx" ON "media_cleanup_jobs" ("state", "next_attempt_at");
