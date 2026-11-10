import { afterEach, expect, it, vi } from "vitest";
import { assertInfistarModel, infistarChatModel, requestInfistarChat } from "@/lib/ai/infistar-client";
import { requestProviderChat } from "@/lib/ai/provider-client";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("maps existing analysis names to exact Infistar IDs", () => {
  expect(infistarChatModel("gemini-3-8-flash-openai")).toBe("gemini-3.8-flash");
  expect(infistarChatModel("deepseek-v4-1-flash")).toBe("deepseek-v4.1-flash");
});
it("routes Infistar vision messages only to Infistar with the exact available model", async () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "Describe this frame" }, { type: "image_url", image_url: { url: "https://media.example/frame.jpg" } }] }];
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "gemini-3.8-flash" }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "A red cube" } }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await requestProviderChat({ provider: "infistar", apiKey: "isolated-vision-fixture", modelId: "gemini-3-8-flash-openai", messages })).toBe("A red cube");
  expect(fetcher.mock.calls.every(call => String(call[0]).startsWith("https://infistar.cc/v1/"))).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ model: "gemini-3.8-flash", messages, stream: false });
});
it("does not submit inference or try KIE when a model is absent", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(requestInfistarChat({ apiKey: "missing-model-fixture", modelId: "missing", messages: [] })).rejects.toMatchObject({ outcome: "not_sent" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("allows verified auto-group video models omitted from the key catalog", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(assertInfistarModel("auto-group-fixture", "kling-v3")).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(assertInfistarModel("auto-group-fixture", "kling-v2-6")).rejects.toMatchObject({ outcome: "not_sent" });
});
it("does not expose upstream credentials or error bodies", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "deepseek-v4.1-flash" }] }))
    .mockResolvedValueOnce(Response.json({ error: { message: "private-fixture echoed" } }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(requestInfistarChat({ apiKey: "error-fixture", modelId: "deepseek-v4-1-flash", messages: [] })).rejects.toThrow("Infistar 请求失败 (401)");
});
