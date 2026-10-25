import { describe, expect, it, vi } from "vitest";
import { requestKieChatCompletion } from "@/lib/ai/kie-chat-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamResponse(...chunks: string[]) {
  const body = `${chunks.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("KIE chat client", () => {
  it("requests streaming output and combines the response", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true });
      return streamResponse("analysis", " result");
    });

    await expect(requestKieChatCompletion({
      url: "https://api.kie.ai/example",
      apiKey: "test-key",
      payload: { model: "gemini-3-8-flash", messages: [] },
      fetcher,
      delay: async () => undefined,
    })).resolves.toBe("analysis result");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries one KIE 524 response and then returns the streamed result", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 524, msg: "2 times retry fail" }))
      .mockResolvedValueOnce(streamResponse("recovered"));
    const delay = vi.fn(async () => undefined);

    await expect(requestKieChatCompletion({
      url: "https://api.kie.ai/example",
      apiKey: "test-key",
      payload: { model: "gemini-3-8-flash", messages: [] },
      fetcher,
      delay,
    })).resolves.toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("retries one transport timeout and then returns the streamed result", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(streamResponse("recovered after timeout"));
    const delay = vi.fn(async () => undefined);

    await expect(requestKieChatCompletion({
      url: "https://api.kie.ai/example",
      apiKey: "test-key",
      payload: { model: "gemini-3-8-flash", messages: [] },
      fetcher,
      delay,
    })).resolves.toBe("recovered after timeout");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("reports a stable KIE timeout after both attempts time out", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const fetcher = vi.fn(async () => {
      throw timeout;
    });

    await expect(requestKieChatCompletion({
      url: "https://api.kie.ai/example",
      apiKey: "test-key",
      payload: { model: "gemini-3-8-flash", messages: [] },
      fetcher,
      delay: async () => undefined,
    })).rejects.toThrow("KIE request timed out after 2 attempts");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient KIE business errors", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 402, msg: "Insufficient credits" }));

    await expect(requestKieChatCompletion({
      url: "https://api.kie.ai/example",
      apiKey: "test-key",
      payload: { model: "gemini-3-8-flash", messages: [] },
      fetcher,
      delay: async () => undefined,
    })).rejects.toThrow("KIE API error (402): Insufficient credits");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 503, 504])("recovers from transient HTTP %s", async (status) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("Service Unavailable", { status }))
      .mockResolvedValueOnce(streamResponse("recovered"));
    await expect(requestKieChatCompletion({ url: "https://api.kie.ai/example", apiKey: "test", payload: {}, fetcher, delay: async () => {} })).resolves.toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 business error wrapped in HTTP 200", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 503, msg: "Service Unavailable" }))
      .mockResolvedValueOnce(streamResponse("recovered"));
    await expect(requestKieChatCompletion({ url: "https://api.kie.ai/example", apiKey: "test", payload: {}, fetcher, delay: async () => {} })).resolves.toBe("recovered");
  });

  it.each([400, 500, 524])("does not retry a missing media download wrapped as %s", async (code) => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse({ code, msg: "Failed to download fileData.fileUri: HTTP 404" }));
    await expect(requestKieChatCompletion({ url: "https://api.kie.ai/example", apiKey: "test", payload: {}, fetcher, delay: async () => {} })).rejects.toThrow("HTTP 404");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP 503 when the upstream error body has no code", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Service Unavailable" } }, 503))
      .mockResolvedValueOnce(streamResponse("recovered"));
    await expect(requestKieChatCompletion({ url: "https://api.kie.ai/example", apiKey: "test", payload: {}, fetcher, delay: async () => {} })).resolves.toBe("recovered");
  });

  it("stops after a second 503", async () => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse({ code: 503, msg: "Service Unavailable" }));
    await expect(requestKieChatCompletion({ url: "https://api.kie.ai/example", apiKey: "test", payload: {}, fetcher, delay: async () => {} })).rejects.toThrow("(503)");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the shared deadline has less than 30 seconds left", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(241_000);
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse({ code: 503, msg: "Service Unavailable" }));
    try {
      await expect(requestKieChatCompletion({ url: "https://api.kie.ai/example", apiKey: "test", payload: {}, fetcher, delay: async () => {} })).rejects.toThrow("(503)");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
});
