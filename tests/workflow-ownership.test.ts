import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ project: vi.fn(), version: vi.fn(), scenes: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { ...schema, db: { query: { projects: { findFirst: mocks.project }, projectVersions: { findFirst: mocks.version }, sceneVersions: { findMany: mocks.scenes } }, insert: mocks.insert } };
});
vi.mock("@/lib/workflow/scene-analysis", () => ({ analyzeSceneBlueprint: vi.fn(), buildStructuredVideoOverview: vi.fn(), remixSceneBlueprint: vi.fn(), rewriteSceneBlueprint: vi.fn() }));
import { createRemixVersion } from "@/lib/workflow/service";

describe("remix ownership", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects another user's project before reading scenes", async () => {
    mocks.project.mockResolvedValue(undefined);
    await expect(createRemixVersion({ userId: "alice", projectId: "bob-project", sourceVersionId: "bob-version", remixPrompt: "copy" })).rejects.toThrow("Project not found");
    expect(mocks.scenes).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("rejects a foreign source version even when the target project is owned", async () => {
    mocks.project.mockResolvedValue({ id: "alice-project", userId: "alice" });
    mocks.version.mockResolvedValue(undefined);
    await expect(createRemixVersion({ userId: "alice", projectId: "alice-project", sourceVersionId: "bob-version", remixPrompt: "copy" })).rejects.toThrow("Source version not found");
    expect(mocks.scenes).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(mocks.version.mock.calls[0][0].where).params).toEqual(["bob-version", "alice-project"]);
  });
});
