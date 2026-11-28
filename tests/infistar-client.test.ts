import { afterEach, expect, it, vi } from "vitest";
import { assertInfistarModel, infistarChatModel, listInfistarModels, requestInfistarChat } from "@/lib/ai/infistar-client";
import { requestProviderChat } from "@/lib/ai/provider-client";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("maps existing analysis names to exact Infistar IDs", () => {
  expect(infistarChatModel("gemini-3-6-flash-openai")).toBe("gemini-3.6-flash");
  expect(infistarChatModel("deepseek-v4-1-flash")).toBe("deepseek-v4.1-flash");
});
it("routes Infistar vision messages only to Infistar with the exact available model", async () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "Describe this frame" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" } }] }];
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "gemini-3.6-flash" }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "A red cube" } }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await requestProviderChat({ provider: "infistar", apiKey: "isolated-vision-fixture", modelId: "gemini-3-6-flash-openai", messages })).toBe("A red cube");
  expect(fetcher.mock.calls.every(call => String(call[0]).startsWith("https://infistar.cc/v1/"))).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ model: "gemini-3.6-flash", messages, stream: false });
});
it("does not submit inference or try KIE when a model is absent", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(requestInfistarChat({ apiKey: "missing-model-fixture", modelId: "missing", messages: [] })).rejects.toMatchObject({ outcome: "not_sent" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bypasses flaky /models for locally allowlisted video IDs and still rejects unknown IDs", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(assertInfistarModel("auto-group-fixture", "kling-v3")).resolves.toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(assertInfistarModel("auto-group-fixture", "kling-v2-6")).rejects.toMatchObject({ outcome: "not_sent" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not expose upstream credentials or error bodies", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "deepseek-v4.1-flash" }] }))
    .mockResolvedValueOnce(Response.json({ error: { message: "private-fixture echoed" } }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(requestInfistarChat({ apiKey: "error-fixture", modelId: "deepseek-v4-1-flash", messages: [] })).rejects.toThrow("Infistar 请求失败 (401)");
});
it("bypasses the model cache when verifying a key before saving", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }))
    .mockResolvedValueOnce(Response.json({ error: "revoked" }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await listInfistarModels("fresh-save-fixture");
  await listInfistarModels("fresh-save-fixture");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(listInfistarModels("fresh-save-fixture", { refresh: true })).rejects.toThrow("模型查询失败");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
