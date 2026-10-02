import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("migrates an empty database and protects all application tables", async () => {
  const client = new PGlite();
  try {
    await client.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) {
      const migration = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        try { await client.exec(statement); }
        catch (error) { throw new Error(`${entry.tag}: ${error instanceof Error ? error.message : error}`); }
      }
    }
    const tables = await client.query<{ name: string; protected: boolean }>("SELECT relname AS name, relrowsecurity AS protected FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname = 'public' AND relkind = 'r'");
    expect(tables.rows).toHaveLength(36);
    expect(tables.rows.every((table) => table.protected)).toBe(true);
    expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='video_generation' AND column_name='provider'")).rows).toHaveLength(1);
  } finally { await client.close(); }
}, 30_000);
