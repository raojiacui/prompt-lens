import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { assertPromptAllowed, promptModerationHttpFailure } from "@/lib/safety/waffo-prompt-scan";
import { checkDynamicPromptTerms, appendModerationRecord } from "@/lib/safety/moderation-controls";

vi.mock("@/lib/safety/moderation-controls", () => ({
  checkDynamicPromptTerms: vi.fn(async () => null),
  appendModerationRecord: vi.fn(async () => {}),
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const original = {
  merchant: process.env.WAFFO_MERCHANT_ID,
  key: process.env.WAFFO_PRIVATE_KEY,
  enabled: process.env.WAFFO_PROMPT_SCAN_ENABLED,
  projectId: process.env.VERCEL_PROJECT_ID,
  environment: process.env.VERCEL_ENV,
};
function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
afterEach(() => {
  vi.mocked(checkDynamicPromptTerms).mockResolvedValue(null);
  vi.mocked(appendModerationRecord).mockClear();
  restore("WAFFO_MERCHANT_ID", original.merchant);
  restore("WAFFO_PRIVATE_KEY", original.key);
  restore("WAFFO_PROMPT_SCAN_ENABLED", original.enabled);
  restore("VERCEL_PROJECT_ID", original.projectId);
  restore("VERCEL_ENV", original.environment);
});
function withCredentials() {
  process.env.WAFFO_MERCHANT_ID = "MER_test";
  process.env.WAFFO_PRIVATE_KEY = key;
}
function fakeResponse(action: string, status = 200, reasonCode = "allowed") {
  const f = vi.fn(async () => new Response(JSON.stringify({ data: { action, reasonCode } }), {
    status, headers: status === 429 ? { "retry-after": "12" } : { "content-type": "application/json" },
  }));
  return f;
}
describe("Waffo AIGC text prompt scan", () => {
  it("requires live prompt audit and enforced semantic scoring despite optional overrides", async () => {
    process.env.VERCEL_PROJECT_ID = "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV";
    process.env.VERCEL_ENV = "production";
    delete process.env.WAFFO_PROMPT_SCAN_ENABLED;
    withCredentials();
    const fetcher = vi.fn(async () => Response.json({ data: { action: "allow", semanticStatus: "scored" } }));
    await expect(assertPromptAllowed("a safe landscape", { enabled: false, semantic: "off", fetcher })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).semantic).toBe("enforce");
    expect(appendModerationRecord).toHaveBeenCalledWith(expect.objectContaining({ provider: "waffo_prompt_sift", verdict: "allow" }));
    delete process.env.WAFFO_PRIVATE_KEY;
    await expect(assertPromptAllowed("a safe landscape", { enabled: false, fetcher })).rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
  });
  it("does not scan unrelated LLM activity when disabled", async () => {
    delete process.env.WAFFO_MERCHANT_ID;
    delete process.env.WAFFO_PRIVATE_KEY;
    const fetcher = vi.fn();
    await expect(assertPromptAllowed("describe this video", { enabled: false, fetcher })).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed without Waffo credentials once enabled", async () => {
    delete process.env.WAFFO_MERCHANT_ID;
    delete process.env.WAFFO_PRIVATE_KEY;
    await expect(assertPromptAllowed("a sunset", { enabled: true }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
  });

  it("scans a prompt with explicit semantic off outside staging and a valid RSA signature", async () => {
    withCredentials();
    const fetcher = fakeResponse("allow");
    await expect(assertPromptAllowed("  a cat walking  ", { enabled: true, fetcher })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.waffo.ai/v1/actions/verification/scan-prompt");
    const body = String(request.body);
    expect(JSON.parse(body)).toEqual({ prompt: "a cat walking", semantic: "off" });
    const headers = request.headers as Record<string, string>;
    expect(headers["X-Merchant-Id"]).toBe("MER_test");
    const canonical = ["POST", "/v1/actions/verification/scan-prompt", headers["X-Timestamp"], createHash("sha256").update(body).digest("base64")].join("\n");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(canonical);
    expect(verifier.verify(publicKey, headers["X-Signature"], "base64")).toBe(true);
  });

  it("enforces Waffo scanning and semantic scoring in the isolated test project even if the flag is missing", async () => {
    withCredentials();
    delete process.env.WAFFO_PROMPT_SCAN_ENABLED;
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    const fetcher = vi.fn(async () => Response.json({ data: {
      action: "allow", reasonCode: "allowed", semanticStatus: "scored", requestId: "REQ_safe123",
    } }));
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await expect(assertPromptAllowed("a fictional orange cat", { fetcher })).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(request.body))).toEqual({
        prompt: "a fictional orange cat", semantic: "enforce",
      });
      expect(log).toHaveBeenCalledWith("[prompt-scan] verdict", expect.objectContaining({
        action: "allow", semanticStatus: "scored", requestId: "REQ_safe123",
      }));
    } finally { log.mockRestore(); }
  });

  it("never submits when enforced semantic scoring is explicitly unavailable", async () => {
    withCredentials();
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    for (const semanticStatus of ["disabled", "provider_error", "shadow_scored", undefined]) {
      const fetcher = vi.fn(async () => Response.json({ data: {
        action: "allow", reasonCode: "allowed", semanticStatus,
      } }));
      await expect(assertPromptAllowed("an orange cat", { fetcher }))
        .rejects.toMatchObject({ code: "PROMPT_REVIEW_REQUIRED" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("cannot opt out of mandatory scanning on the test project", async () => {
    withCredentials();
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    const fetcher = vi.fn(async () => Response.json({ data: { action: "allow", reasonCode: "allowed", semanticStatus: "scored" } }));
    await expect(assertPromptAllowed("some text", { enabled: false, fetcher })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["review", "review_required", "PROMPT_REVIEW_REQUIRED"],
    ["block", "restricted_content", "PROMPT_BLOCKED"],
    ["unknown", "unknown", "PROMPT_SCAN_UNAVAILABLE"],
    ["allow", "service_degraded", "PROMPT_REVIEW_REQUIRED"],
  ])("never generates for %s with reason %s", async (action, reasonCode, code) => {
    withCredentials();
    await expect(assertPromptAllowed("a person walking", { enabled: true, fetcher: fakeResponse(action, 200, reasonCode) }))
      .rejects.toMatchObject({ code });
  });

  it("fails closed on 429, non-2xx, invalid JSON and network error", async () => {
    withCredentials();
    await expect(assertPromptAllowed("cat", { enabled: true, fetcher: fakeResponse("allow", 429) }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_RATE_LIMITED", retryAfterSeconds: 12 });
    await expect(assertPromptAllowed("cat", { enabled: true, fetcher: fakeResponse("allow", 500) }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
    await expect(assertPromptAllowed("cat", { enabled: true, fetcher: vi.fn().mockResolvedValue(new Response("oops")) }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
    await expect(assertPromptAllowed("cat", { enabled: true, fetcher: vi.fn().mockRejectedValue(new Error("timeout")) }))
      .rejects.toMatchObject({ code: "PROMPT_SCAN_UNAVAILABLE" });
  });

  it("maps errors to safe Chinese user messages without prompt text", async () => {
    withCredentials();
    try {
      await assertPromptAllowed("private user prompt", { enabled: true, fetcher: fakeResponse("block") });
    } catch (error) {
      const message = promptModerationHttpFailure(error);
      expect(message?.status).toBe(422);
      expect(JSON.stringify(message)).not.toContain("private user prompt");
      return;
    }
    throw new Error("Expected moderation to block");
  });
  it("enforces an enabled dynamic rule before submitting to the Waffo API", async () => {
    withCredentials();
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    vi.mocked(checkDynamicPromptTerms).mockResolvedValueOnce({ id: "fixture", category: "deepfake", action: "block" });
    const fetcher = vi.fn();
    await expect(assertPromptAllowed("test phrase", { fetcher, userId: "user-test" }))
      .rejects.toMatchObject({ code: "PROMPT_BLOCKED" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(appendModerationRecord).toHaveBeenCalledWith(expect.objectContaining({
      provider: "local_terms", verdict: "block", userId: "user-test",
    }));
  });
  it("writes a content-minimal Waffo audit event when accepted", async () => {
    withCredentials();
    process.env.VERCEL_PROJECT_ID = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";
    await assertPromptAllowed("harmless cat", {
      fetcher: vi.fn(async () => Response.json({ data: { action: "allow", reasonCode: "allowed", semanticStatus: "scored" } })),
      userId: "user-test",
    });
    expect(appendModerationRecord).toHaveBeenCalledWith(expect.objectContaining({
      provider: "waffo_prompt_sift", verdict: "allow", userId: "user-test",
    }));
  });

});
