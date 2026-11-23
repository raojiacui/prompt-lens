ALTER TABLE commercial_lots ADD COLUMN expires_at timestamptz;
ALTER TABLE commercial_lots ADD COLUMN expired_credits integer NOT NULL DEFAULT 0;
ALTER TABLE commercial_lots ADD COLUMN expired_rewrites integer NOT NULL DEFAULT 0;
ALTER TABLE commercial_lots DROP CONSTRAINT commercial_lot_amounts;
ALTER TABLE commercial_lots ADD CONSTRAINT commercial_lot_amounts CHECK (
  available_credits >= 0 AND available_rewrites >= 0 AND held_credits >= 0 AND held_rewrites >= 0
  AND used_credits >= 0 AND used_rewrites >= 0 AND expired_credits >= 0 AND expired_rewrites >= 0
  AND credits = available_credits + held_credits + used_credits + expired_credits
  AND rewrites = available_rewrites + held_rewrites + used_rewrites + expired_rewrites
);
ALTER TABLE commercial_lots DROP CONSTRAINT commercial_lot_state;
ALTER TABLE commercial_lots ADD CONSTRAINT commercial_lot_state CHECK (state IN ('active','expired','refunding','refunded','review'));
CREATE INDEX commercial_lot_expiry_idx ON commercial_lots(user_id, expires_at) WHERE expires_at IS NOT NULL AND state = 'active';
