import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { assertPromptAllowed, PromptModerationError } from "@/lib/safety/waffo-prompt-scan";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const originalMerchant = process.env.WAFFO_MERCHANT_ID;
const originalKey = process.env.WAFFO_PRIVATE_KEY;
afterEach(() => {
  if (originalMerchant === undefined) delete process.env.WAFFO_MERCHANT_ID;
  else process.env.WAFFO_MERCHANT_ID = originalMerchant;
  if (originalKey === undefined) delete process.env.WAFFO_PRIVATE_KEY;
  else process.env.WAFFO_PRIVATE_KEY = originalKey;
});

const mock = (action: string, status = 200): typeof fetch => vi.fn(async () =>
  new Response(JSON.stringify({ data: { action } }), { status, headers: { "content-type": "application/json" } })
) as unknown as typeof fetch;

describe("Waffo prompt moderation", () => {
  it("is off unless explicitly enabled", async () => {
    delete process.env.WAFFO_MERCHANT_ID;
    delete process.env.WAFFO_PRIVATE_KEY;
    await expect(assertPromptAllowed("a sunset", { enabled: false })).resolves.toBeUndefined();
  });

  it("fails closed without merchant credentials", async () => {
    delete process.env.WAFFO_MERCHANT_ID;
    delete process.env.WAFFO_PRIVATE_KEY;
    await expect(assertPromptAllowed("a sunset", { enabled: true })).rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
  });

  it.each(["allow", "review", "block", "unexpected"])("handles action %s safely", async action => {
    process.env.WAFFO_MERCHANT_ID = "MER_test";
    process.env.WAFFO_PRIVATE_KEY = key;
    const fetcher = mock(action);
    const check = assertPromptAllowed("a cat walking", { enabled: true, fetcher });
    if (action === "allow") await expect(check).resolves.toBeUndefined();
    else await expect(check).rejects.toMatchObject({
      code: action === "block" ? "PROMPT_BLOCKED" : action === "review" ? "PROMPT_REVIEW_REQUIRED" : "PROMPT_SCAN_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, request] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({ prompt: "a cat walking", semantic: "shadow" });
    expect(request.headers["X-Signature"]).toBeTruthy();
  });

  it("rejects rate limits and transport failures without allowing generation", async () => {
    process.env.WAFFO_MERCHANT_ID = "MER_test";
    process.env.WAFFO_PRIVATE_KEY = key;
    await expect(assertPromptAllowed("cat", { enabled: true, fetcher: mock("allow", 429) }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_RATE_LIMITED" });
    await expect(assertPromptAllowed("cat", { enabled: true, fetcher: vi.fn().mockRejectedValue(new Error("timeout")) }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
  });
});
