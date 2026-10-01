import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";

export async function adminQuery<T>(query: SQL): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '4000ms'`);
    const result = await tx.execute(query);
    return (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows || []) as T[];
  });
}
