import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, admin: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ getAdminUserFromHeaders: mocks.admin }));
import { POST } from "@/app/api/admin/moderation/route";
import { checkDynamicPromptTerms, deleteModerationTerm, updateModerationTerm } from "@/lib/safety/moderation-controls";

const client = new PGlite();
const db = drizzle(client, { schema });
mocks.db = db;
const actorId = randomUUID();
const request = (id: string, origin = "https://staging.example") => new NextRequest("https://staging.example/api/admin/moderation", {
  method: "POST", headers: { origin, "Content-Type": "application/json" },
  body: JSON.stringify({ action: "delete_term", id }),
});
const create = () => updateModerationTerm({ phrase: "测试规则731", category: "other", action: "block", enabled: true, actorId });

beforeAll(async () => {
  await client.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await client.exec(readFileSync("drizzle/0026_moderation_controls.sql", "utf8"));
});
beforeEach(async () => {
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI");
  mocks.admin.mockResolvedValue({ id: actorId });
  await client.exec("TRUNCATE moderation_terms, moderation_records;");
});
afterAll(async () => { vi.unstubAllEnvs(); await client.close(); });

it("deletes the rule, preserves audit history and permits re-adding the phrase", async () => {
  const term = await create();
  expect(await checkDynamicPromptTerms(term.phrase)).toMatchObject({ id: term.id });
  expect((await POST(request(term.id))).status).toBe(200);
  expect(await checkDynamicPromptTerms(term.phrase)).toBeNull();
  expect(await db.select().from(schema.moderationTerms)).toHaveLength(0);
  const records = await db.select().from(schema.moderationRecords);
  expect(records).toHaveLength(2);
  expect(records.find(x => x.verdict === "deleted")).toMatchObject({ ruleId: term.id, reviewerId: actorId, reasonCode: "term_deleted", reviewNote: expect.stringContaining(term.phrase) });
  expect((await POST(request(term.id))).status).toBe(404);
  const replacement = await create();
  expect(replacement.id).not.toBe(term.id);
});

it("rolls back deletion if the audit cannot be saved", async () => {
  const term = await create();
  await client.exec("ALTER TABLE moderation_records ADD CONSTRAINT reject_deletion_fixture CHECK (verdict <> 'deleted');");
  try {
    await expect(deleteModerationTerm(term.id, actorId)).rejects.toThrow();
    expect(await checkDynamicPromptTerms(term.phrase)).toMatchObject({ id: term.id });
    expect(await db.select().from(schema.moderationRecords)).toHaveLength(1);
  } finally {
    await client.exec("ALTER TABLE moderation_records DROP CONSTRAINT reject_deletion_fixture;");
  }
});

it("supports the authorized live production deployment with the same audit boundary", async () => {
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV");
  vi.stubEnv("VERCEL_ENV", "production");
  try {
    const term = await create();
    expect((await POST(request(term.id))).status).toBe(200);
    expect(await db.select().from(schema.moderationTerms)).toHaveLength(0);
    expect(await db.select().from(schema.moderationRecords)).toHaveLength(2);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("rejects non-admin, cross-origin, malformed and non-test requests", async () => {
  const term = await create();
  mocks.admin.mockResolvedValue(null);
  expect((await POST(request(term.id))).status).toBe(403);
  mocks.admin.mockResolvedValue({ id: actorId });
  expect((await POST(request(term.id, "https://other.example"))).status).toBe(403);
  expect((await POST(request("invalid"))).status).toBe(400);
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV");
  expect((await POST(request(term.id))).status).toBe(404);
  expect(await db.select().from(schema.moderationTerms)).toHaveLength(1);
});
