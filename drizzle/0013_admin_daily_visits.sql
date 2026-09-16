CREATE TABLE IF NOT EXISTS "daily_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" varchar(10) NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"user_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"path" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_visits" ADD CONSTRAINT "daily_visits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_daily_visits_date_session" ON "daily_visits" USING btree ("date", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_daily_visits_date" ON "daily_visits" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_daily_visits_user_id" ON "daily_visits" USING btree ("user_id");
