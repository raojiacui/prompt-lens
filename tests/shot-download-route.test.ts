import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mocked = vi.hoisted(() => ({ session: vi.fn(), task: vi.fn(), project: vi.fn(), scene: vi.fn(), asset: vi.fn(), media: vi.fn(), values: vi.fn(), stream: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocked.session } } }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), db: { query: { commercialTasks: { findFirst: mocked.task }, projects: { findFirst: mocked.project }, videoScenes: { findFirst: mocked.scene }, projectAssets: { findFirst: mocked.asset } }, insert: () => ({ values: mocked.values }) } }));
vi.mock("@/lib/billing/commercial-media", () => ({ commercialMediaRequest: mocked.media }));
vi.mock("@/lib/cloudflare/r2", () => ({ extractR2Key: (url: string) => url }));
vi.mock("@/lib/workflow/shot-download", () => ({ streamShotDownload: mocked.stream }));

import { POST as preparedShot } from "@/app/api/commercial/analysis/[id]/shots/[sceneId]/route";
import { GET as historicalShot } from "@/app/api/workflow/projects/[id]/shots/[sceneId]/download/route";

const id = "11111111-1111-4111-8111-111111111111";
const sceneId = "22222222-2222-4222-8222-222222222222";
const callPreview = () => preparedShot(new NextRequest("http://localhost/api/shot", { method: "POST", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id, sceneId: "2" }) });
const callHistory = () => historicalShot(new NextRequest("http://localhost/api/shot"), { params: Promise.resolve({ id, sceneId }) });

describe("Owned shot downloads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.session.mockResolvedValue({ user: { id: "owner" } });
    mocked.task.mockResolvedValue({ createdAt: new Date(), input: { projectId: id, automaticSplit: true, mediaUrl: "https://storage/source.mp4", preview: { sourceHash: "hash", scenes: [{ id: "1", startUs: 0, endUs: 2000000 }, { id: "2", startUs: 2000000, endUs: 10000000 }] } } });
    mocked.project.mockResolvedValue({ metadata: {} });
    mocked.scene.mockResolvedValue({ clipUrl: "https://storage/history.mp4", sceneIndex: 2 });
    mocked.asset.mockResolvedValue({ url: "https://storage/shot-2.mp4" });
    mocked.media.mockResolvedValue({ scenes: [{ startTime: 2, endTime: 10, clipUrl: "https://storage/shot-2.mp4", keyframeUrls: [] }] });
    mocked.stream.mockImplementation(async () => new Response("clip", { headers: { "Content-Type": "video/mp4" } }));
  });
  it.each([callPreview, callHistory])("requires login before looking up media", async call => {
    mocked.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocked.task).not.toHaveBeenCalled(); expect(mocked.project).not.toHaveBeenCalled(); expect(mocked.stream).not.toHaveBeenCalled();
  });
  it("binds preparation and project lookups to the current owner", async () => {
    expect((await callPreview()).status).toBe(200);
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(mocked.task.mock.calls[0][0].where).params).toContain("owner");
    expect(dialect.sqlToQuery(mocked.project.mock.calls[0][0].where).params).toContain("owner");
    expect(mocked.stream).toHaveBeenCalledWith("https://storage/shot-2.mp4", 2, expect.any(AbortSignal));
  });
  it("cuts only the requested server interval without a billing task", async () => {
    mocked.asset.mockResolvedValue(undefined);
    expect((await callPreview()).status).toBe(200);
    expect(mocked.media).toHaveBeenCalledWith("https://storage/source.mp4", { mode: "assets", sourceHash: "hash", scenes: [{ id: "2", startUs: 2000000, endUs: 10000000 }] });
    expect(mocked.values).toHaveBeenCalled();
    expect(mocked.task).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin clip preparation before accessing media", async () => {
    const response = await preparedShot(new NextRequest("http://localhost/api/shot", { method: "POST", headers: { origin: "https://other.example" } }), { params: Promise.resolve({ id, sceneId: "2" }) });
    expect(response.status).toBe(403);
    expect(mocked.task).not.toHaveBeenCalled();
  });
  it("rejects unknown shots without extracting any media", async () => {
    const response = await preparedShot(new NextRequest("http://localhost/api/shot", { method: "POST", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id, sceneId: "unknown" }) });
    expect(response.status).toBe(404);
    expect(mocked.media).not.toHaveBeenCalled();
  });
  it("does not export a worker clip with different boundaries", async () => {
    mocked.asset.mockResolvedValue(undefined);
    mocked.media.mockResolvedValue({ scenes: [{ startTime: 0, endTime: 10, clipUrl: "https://storage/wrong.mp4", keyframeUrls: [] }] });
    expect((await callPreview()).status).toBe(502);
    expect(mocked.stream).not.toHaveBeenCalled();
    expect(mocked.values).not.toHaveBeenCalled();
  });
  it("reuses the stored clip without another extraction", async () => {
    expect((await callPreview()).status).toBe(200);
    expect(mocked.media).not.toHaveBeenCalled();
  });
  it.each([callPreview, callHistory])("blocks expired project files", async call => {
    mocked.project.mockResolvedValue({ metadata: { retentionExpiredAt: new Date().toISOString() } });
    expect((await call()).status).toBe(404);
    expect(mocked.stream).not.toHaveBeenCalled();
  });
  it("downloads a historical shot without starting a split or analysis task", async () => {
    expect((await callHistory()).status).toBe(200);
    expect(mocked.stream).toHaveBeenCalledWith("https://storage/history.mp4", 2, expect.any(AbortSignal));
    expect(mocked.media).not.toHaveBeenCalled(); expect(mocked.task).not.toHaveBeenCalled();
  });
  it("reports a missing storage file instead of an empty successful download", async () => {
    mocked.stream.mockRejectedValueOnce(new Error("gone"));
    expect((await callHistory()).status).toBe(502);
  });
});
