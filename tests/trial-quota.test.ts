import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const isolated = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return isolated.db; } }));
vi.mock("@/lib/auth", () => ({ isAdminProfile: () => false }));

import { completeTrialAnalysis, getUserTrialUsage, releaseTrialAnalysis, reserveTrialAnalysis, TrialQuotaError } from "@/lib/usage/trial-quota";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const client = new PGlite();
isolated.db = drizzle(client, { schema });
const userId = randomUUID();
let reservationId: string;

describe("trial reservation", () => {
  beforeAll(async () => {
    await client.exec(readFileSync("drizzle/0000_dear_prism.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0005_v2_workflow.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0016_trial_analysis_usage.sql", "utf8"));
    await client.exec(readFileSync("drizzle/0017_request_reservations.sql", "utf8"));
    await client.query('INSERT INTO "user" (id, email) VALUES ($1, $2)', [userId, "trial@example.com"]);
  });
  afterAll(async () => { await client.close(); });

  it("does not count a completed BYOK project as a trial", async () => {
    await client.query('INSERT INTO projects (user_id, title, status) VALUES ($1, $2, $3)', [userId, "Own KIE key", "ready"]);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 0, remaining: 2 });
  });

  it("reserves at most two calls even when three start together", async () => {
    const results = await Promise.allSettled([
      reserveTrialAnalysis(userId),
      reserveTrialAnalysis(userId),
      reserveTrialAnalysis(userId),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    reservationId = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<string>).value;
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(TrialQuotaError);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 2, remaining: 0 });
  });

  it("returns a failed reservation without granting a third free call", async () => {
    await releaseTrialAnalysis(reservationId);
    await releaseTrialAnalysis(reservationId);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1, remaining: 1 });
    reservationId = (await reserveTrialAnalysis(userId, "retry"))!;
    expect(await reserveTrialAnalysis(userId, "retry")).toBe(reservationId);
    await expect(reserveTrialAnalysis(userId)).rejects.toBeInstanceOf(TrialQuotaError);
  });

  it("keeps successful usage but returns abandoned reservations", async () => {
    await completeTrialAnalysis(reservationId);
    await releaseTrialAnalysis(reservationId);
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 2 });
    await client.query("UPDATE trial_analysis_reservations SET expires_at = now() - interval '1 minute' WHERE state = 'pending'");
    expect(await getUserTrialUsage(userId)).toMatchObject({ used: 1, remaining: 1 });
    await expect(completeTrialAnalysis(reservationId)).resolves.toBeUndefined();
  });

  it("shares a rate limit across concurrent requests and resets expired windows", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => checkRateLimit("shared", 3, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    await client.query("UPDATE api_rate_limits SET reset_at = now() - interval '1 minute'");
    expect(await checkRateLimit("shared", 3, 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });
});
