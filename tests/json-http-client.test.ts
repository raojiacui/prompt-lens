import { describe, expect, it, vi } from "vitest";

import {
  JsonHttpError,
  postJson,
} from "@/lib/http/json-client";

describe("JSON HTTP client", () => {
  it("posts JSON with a bounded timeout and returns parsed data", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ prompt: "hello" }));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(postJson<{ ok: boolean }>(
      "https://provider.example/v1/run",
      { prompt: "hello" },
      { timeoutMs: 30_000, fetcher },
    )).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves the HTTP status and provider error body", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "invalid key" },
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));

    const request = postJson(
      "https://provider.example/v1/run",
      {},
      { fetcher },
    );

    await expect(request).rejects.toMatchObject({
      name: "JsonHttpError",
      status: 401,
      data: { error: { message: "invalid key" } },
    });
    await expect(request).rejects.toBeInstanceOf(JsonHttpError);
  });

  it("rejects a successful response that is not valid JSON", async () => {
    const fetcher = vi.fn(async () => new Response("not-json", { status: 200 }));

    await expect(postJson(
      "https://provider.example/v1/run",
      {},
      { fetcher },
    )).rejects.toThrow("returned invalid JSON");
  });
});
