import { sql, type SQLWrapper } from "drizzle-orm";
import { OWNER_EMAIL } from "@/lib/auth/admin-policy";

// Match the server's verified administrator identity, never a client role flag.
// This exception affects automatic content retention only, not billing or keys.
export function adminRetainsMedia(ownerId: SQLWrapper) {
  return sql`exists (select 1 from "user" retention_owner
    where retention_owner.id = ${ownerId}
      and lower(btrim(retention_owner.email)) = ${OWNER_EMAIL}
      and retention_owner.email_verified = true
      and coalesce(retention_owner.banned, false) = false
      and coalesce(retention_owner.is_anonymous, false) = false)`;
}
