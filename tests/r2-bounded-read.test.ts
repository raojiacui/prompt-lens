import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = mocks.send; },
}));
let getFromR2: typeof import("@/lib/cloudflare/r2").getFromR2;
beforeAll(async () => {
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
  ({ getFromR2 } = await import("@/lib/cloudflare/r2"));
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => mocks.send.mockReset());

describe("bounded authenticated R2 reads", () => {
  it("reads from the configured bucket and passes the shared abort signal", async () => {
    const signal = new AbortController().signal;
    mocks.send.mockResolvedValue({ Body: Readable.from([Buffer.from("ab"), Buffer.from("cd")]), ContentLength: 4 });
    expect((await getFromR2("frames/one.jpg", 4, signal)).toString()).toBe("abcd");
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: "test-bucket", Key: "frames/one.jpg" });
    expect(mocks.send.mock.calls[0][1]).toEqual({ abortSignal: signal });
  });

  it("aborts oversized streams even when Content-Length is omitted", async () => {
    const body = Readable.from([Buffer.alloc(3), Buffer.alloc(3)]);
    mocks.send.mockResolvedValue({ Body: body });
    await expect(getFromR2("frames/one.jpg", 4)).rejects.toMatchObject({ cause: expect.any(RangeError) });
    expect(body.destroyed).toBe(true);
  });

  it("rejects oversized Content-Length before buffering the object", async () => {
    const body = Readable.from([Buffer.alloc(1)]);
    mocks.send.mockResolvedValue({ Body: body, ContentLength: 5 });
    await expect(getFromR2("frames/one.jpg", 4)).rejects.toMatchObject({ cause: expect.any(RangeError) });
    expect(body.destroyed).toBe(true);
  });
});
