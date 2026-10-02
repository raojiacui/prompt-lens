import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("private application database", () => {
  it("removes permissive policies and denies public reads and balance writes", async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE verification (id integer); CREATE TABLE user_api_keys (id integer);
        CREATE TABLE user_credits (id integer); CREATE TABLE analysis_history (id integer);
        GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
        ALTER TABLE verification ENABLE ROW LEVEL SECURITY;
        CREATE POLICY open_verification ON verification FOR ALL USING (true);`);
      const migration = readFileSync("drizzle/0021_private_application_tables.sql", "utf8");
      await client.exec(migration);
      await client.exec(migration);
      expect((await client.query("SELECT * FROM pg_policies WHERE schemaname = 'public'")).rows).toHaveLength(0);
      for (const role of ["anon", "authenticated"]) {
        await client.exec(`SET ROLE ${role}`);
        await expect(client.query("SELECT * FROM verification")).rejects.toThrow(/permission denied/);
        await expect(client.query("SELECT * FROM user_api_keys")).rejects.toThrow(/permission denied/);
        await expect(client.query("SELECT * FROM analysis_history")).rejects.toThrow(/permission denied/);
        await expect(client.query("INSERT INTO user_credits VALUES (999999)")).rejects.toThrow(/permission denied/);
        await client.exec("RESET ROLE");
      }
      await expect(client.query("INSERT INTO user_credits VALUES (1)")).resolves.toBeDefined();
    } finally { await client.close(); }
  });
});
