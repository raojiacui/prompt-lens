import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), rate: vi.fn(), values: vi.fn() }));
vi.mock("@/lib/reference-video/auth", () => ({ requireReferenceVideoUser: mocks.auth }));
vi.mock("@/lib/cloudflare/r2", () => ({ uploadToR2: mocks.upload }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: mocks.values }) }, operationLogs: {} }));
import { POST } from "@/app/api/project-assets/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "alice" }, response: null });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.upload.mockResolvedValue("https://media.test/users/alice/assets/file.png");
});
function request(file: File, origin = "https://app.test") {
  const form = new FormData(); form.set("file", file);
  return new Request("https://app.test/api/project-assets", { method: "POST", headers: { origin }, body: form });
}
it("rejects unsupported files before upload", async () => {
  expect((await POST(request(new File(["executable"], "asset.exe", { type: "application/octet-stream" })))).status).toBe(415);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("rejects oversized assets before upload", async () => {
  expect((await POST(request(new File([new Uint8Array(15 * 1024 * 1024 + 1)], "asset.png", { type: "image/png" })))).status).toBe(413);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("rejects cross-site requests and excessive uploads", async () => {
  const file = new File(["image"], "asset.png", { type: "image/png" });
  expect((await POST(request(file, "https://evil.test"))).status).toBe(403);
  mocks.rate.mockResolvedValue({ allowed: false });
  expect((await POST(request(file))).status).toBe(429);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("puts valid uploads only in the current user's namespace", async () => {
  expect((await POST(request(new File(["image"], "asset.png", { type: "image/png" })))).status).toBe(200);
  expect(mocks.upload).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/^users\/alice\/assets\//), "image/png");
});
