import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, userId: "", size: 123, sign: vi.fn() }));
vi.mock("@/lib/db", async () => ({ ...await import("@/lib/db/schema"), get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: mocks.userId } }) } } }));
vi.mock("@/lib/cloudflare/r2", () => ({
  getPresignedUploadUrl: mocks.sign,
  getR2PublicUrl: (key: string) => `https://media.example/${key}`,
  getR2ObjectSize: async () => mocks.size,
  extractR2Key: (url: string) => url.startsWith("https://media.example/") ? url.slice(22) : null,
  getSignedUrlFromR2: vi.fn(),
}));
import { POST as requestUpload } from "@/app/api/upload/route";
import { POST as completeUpload } from "@/app/api/upload/complete/route";
import { assertOwnedUploadedVideo } from "@/lib/billing/commercial-media";

const client = new PGlite();
const testDb = drizzle(client, { schema });
mocks.db = testDb;
function request(body: unknown) {
  return new NextRequest("http://localhost/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function reserve(mediaType: "video" | "image" = "video") {
  const payload = { filename: mediaType === "video" ? " clip.mp4" : "image.png", contentType: `${mediaType}/${mediaType === "video" ? "mp4" : "png"}`, size: 123, mediaType };
  const response = await requestUpload(request(payload));
  expect(response.status).toBe(200);
  const data = await response.json();
  return { ...payload, key: data.key, url: data.publicUrl };
}
describe("upload to analysis boundary", () => {
  beforeAll(async () => {
    for (const migration of ["0000_dear_prism", "0017_request_reservations"]) {
      await client.exec(readFileSync(`drizzle/${migration}.sql`, "utf8"));
    }
  });
  beforeEach(async () => {
    mocks.userId = randomUUID(); mocks.size = 123;
    mocks.sign.mockReset().mockResolvedValue("https://signed.example/upload");
    await testDb.insert(schema.user).values({ id: mocks.userId, email: `${mocks.userId}@example.com` });
  });
  afterAll(async () => { await client.close(); });

  it.each(["video", "image"] as const)("accepts only completed %s uploads and completes idempotently", async (type) => {
    const upload = await reserve(type);
    expect(mocks.sign).toHaveBeenCalledWith(upload.key, upload.contentType, 600, 123);
    await expect(assertOwnedUploadedVideo(mocks.userId, upload.url, type)).rejects.toThrow("UPLOAD_NOT_OWNED");
    expect((await completeUpload(request(upload))).status).toBe(200);
    expect((await completeUpload(request(upload))).status).toBe(200);
    await expect(assertOwnedUploadedVideo(mocks.userId, upload.url, type)).resolves.toBe(upload.key);
    await expect(assertOwnedUploadedVideo(randomUUID(), upload.url, type)).rejects.toThrow("UPLOAD_NOT_OWNED");
    await expect(assertOwnedUploadedVideo(mocks.userId, upload.url, type === "video" ? "image" : "video")).rejects.toThrow("UPLOAD_NOT_OWNED");
    const logs = (await testDb.select().from(schema.operationLogs)).filter(row => row.userId === mocks.userId);
    expect(logs).toHaveLength(1);
  });
  it("rejects unreserved objects, changed payloads and actual size mismatches", async () => {
    const upload = await reserve();
    expect((await completeUpload(request({ ...upload, size: 124 }))).status).toBe(409);
    expect((await completeUpload(request({ ...upload, filename: "other.mp4" }))).status).toBe(409);
    const key = `uploads/${mocks.userId}/video/unreserved.mp4`;
    expect((await completeUpload(request({ ...upload, key, url: `https://media.example/${key}` }))).status).toBe(409);
    mocks.size = 124;
    expect((await completeUpload(request(upload))).status).toBe(409);
    await expect(assertOwnedUploadedVideo(mocks.userId, upload.url)).rejects.toThrow("UPLOAD_NOT_OWNED");
  });
  it.each([0, -1, 1.5, 501 * 1024 * 1024])("rejects invalid size %s before signing", async (size) => {
    expect((await requestUpload(request({ filename: "a.mp4", contentType: "video/mp4", size, mediaType: "video" }))).status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("accepts server uploads but never treats a legacy signature as upload completion", async () => {
    const key = `uploads/${mocks.userId}/video/server.mp4`;
    const url = `https://media.example/${key}`;
    await testDb.insert(schema.operationLogs).values({ userId: mocks.userId, action: "file.upload", resourceType: "video", metadata: { storageKey: key, url, phase: "presigned" } });
    await expect(assertOwnedUploadedVideo(mocks.userId, url)).rejects.toThrow("UPLOAD_NOT_OWNED");
    await testDb.insert(schema.operationLogs).values({ userId: mocks.userId, action: "file.upload", resourceType: "video", metadata: { storageKey: key, url, phase: "server-upload" } });
    await expect(assertOwnedUploadedVideo(mocks.userId, url)).resolves.toBe(key);
  });
});
