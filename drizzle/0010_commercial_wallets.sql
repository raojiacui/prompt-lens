CREATE TABLE "commercial_wallets" (
  "user_id" uuid PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "credits" integer NOT NULL DEFAULT 0,
  "rewrites" integer NOT NULL DEFAULT 0,
  "held_credits" integer NOT NULL DEFAULT 0,
  "held_rewrites" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "commercial_wallet_nonnegative" CHECK (credits >= 0 AND rewrites >= 0 AND held_credits >= 0 AND held_rewrites >= 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "task_key" varchar(160) NOT NULL,
  "credits" integer NOT NULL,
  "rewrites" integer NOT NULL,
  "settled_credits" integer,
  "settled_rewrites" integer,
  "state" varchar(20) NOT NULL DEFAULT 'held',
  "quote" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "commercial_reservation_amounts" CHECK (
    credits >= 0 AND rewrites >= 0 AND (
      state = 'held' AND settled_credits IS NULL AND settled_rewrites IS NULL OR
      state = 'settled' AND settled_credits IS NOT NULL AND settled_rewrites IS NOT NULL
      AND settled_credits BETWEEN 0 AND credits AND settled_rewrites BETWEEN 0 AND rewrites
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_reservation_task_unique" ON "commercial_reservations" (user_id, task_key);
--> statement-breakpoint
CREATE TABLE "commercial_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "event_key" varchar(200) NOT NULL,
  "credits" integer NOT NULL,
  "rewrites" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_ledger_event_unique" ON "commercial_ledger" (event_key);
--> statement-breakpoint
CREATE INDEX "commercial_ledger_user_idx" ON "commercial_ledger" (user_id);
