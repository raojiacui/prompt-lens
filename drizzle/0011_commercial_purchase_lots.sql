ALTER TABLE commercial_wallets ADD COLUMN frozen boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE commercial_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  credits integer NOT NULL, rewrites integer NOT NULL,
  available_credits integer NOT NULL, available_rewrites integer NOT NULL,
  held_credits integer NOT NULL DEFAULT 0, held_rewrites integer NOT NULL DEFAULT 0,
  used_credits integer NOT NULL DEFAULT 0, used_rewrites integer NOT NULL DEFAULT 0,
  state varchar(24) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_lot_amounts CHECK (
    available_credits >= 0 AND available_rewrites >= 0 AND held_credits >= 0 AND held_rewrites >= 0 AND used_credits >= 0 AND used_rewrites >= 0
    AND credits = available_credits + held_credits + used_credits
    AND rewrites = available_rewrites + held_rewrites + used_rewrites
  ),
  CONSTRAINT commercial_lot_state CHECK (state IN ('active', 'refunding', 'refunded', 'review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX commercial_lot_order_unique ON commercial_lots(order_id);
CREATE INDEX commercial_lot_user_idx ON commercial_lots(user_id);
--> statement-breakpoint
CREATE TABLE commercial_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES commercial_reservations(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES commercial_lots(id),
  credits integer NOT NULL CHECK(credits >= 0), rewrites integer NOT NULL CHECK(rewrites >= 0)
);
CREATE UNIQUE INDEX commercial_allocation_unique ON commercial_allocations(reservation_id,lot_id);
--> statement-breakpoint
CREATE TABLE commercial_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES payment_orders(id),
  user_id uuid NOT NULL REFERENCES "user"(id),
  state varchar(24) NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','processing','succeeded','failed','review')),
  reason text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commercial_refund_order_unique ON commercial_refunds(order_id);
--> statement-breakpoint
-- Never fabricate historical allocations. Existing nonempty wallets require reconciliation.
UPDATE commercial_wallets SET frozen = true WHERE credits + rewrites + held_credits + held_rewrites > 0;
