import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds Infistar without changing existing ciphertext and enforces one preferred key per user", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TYPE api_provider AS ENUM ('kie'); CREATE TABLE user_api_keys (user_id text, provider api_provider, api_key text); INSERT INTO user_api_keys VALUES ('user', 'kie', 'encrypted-fixture');");
    await db.exec(await readFile("drizzle/0025_infistar_byok.sql", "utf8"));
    expect((await db.query("SELECT api_key, is_preferred FROM user_api_keys")).rows).toEqual([{ api_key: "encrypted-fixture", is_preferred: false }]);
    await db.exec("INSERT INTO user_api_keys VALUES ('user', 'infistar', 'new-encrypted-fixture', true)");
    await expect(db.exec("UPDATE user_api_keys SET is_preferred = true WHERE provider = 'kie'")).rejects.toThrow();
    expect((await db.query("SELECT provider FROM user_api_keys WHERE is_preferred")).rows).toEqual([{ provider: "infistar" }]);
  } finally { await db.close(); }
});
