import { afterEach, describe, expect, it, vi } from "vitest";
import { inlineAnalysisImages } from "@/lib/ai/analysis-images";
import { requestProviderChat } from "@/lib/ai/provider-client";
const storage = vi.hoisted(() => ({ key: vi.fn(), signed: vi.fn(async () => "https://storage.example/signed") }));
vi.mock("@/lib/cloudflare/r2", () => ({ extractR2Key: storage.key, getSignedUrlFromR2: storage.signed }));
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const messages = [{ role: "user", content: [{ type: "text", text: "Describe the image" }, { type: "image_url", image_url: { url: "https://our-storage.example/image" } }] }];
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("analysis image delivery", () => {
  it("delivers downloaded bytes with KIE's documented inline_data fields without leaking the provider key to storage", async () => {
    storage.key.mockReturnValue("uploads/owned.png");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: "visible image" }] } }] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestProviderChat({ apiKey: "private-key", modelId: "gemini-3-6-flash-openai", messages })).toBe("visible image");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[1][1].body).contents[0].parts[1]).toEqual({ inline_data: { mime_type: "image/png", data: bytes.toString("base64") } });
  });
  it("never fetches an untrusted URL or submits inference for it", async () => {
    storage.key.mockReturnValue(null);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(requestProviderChat({ apiKey: "key", modelId: "gemini-3-6-flash-openai", messages })).rejects.toMatchObject({ outcome: "not_sent" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([new Response("HTML error", { headers: { "Content-Type": "image/png" } }), new Response("missing", { status: 404 }), new Response("", { headers: { "Content-Length": String(9 * 1024 * 1024) } })])("rejects inaccessible, invalid or oversized images before inference", async response => {
    storage.key.mockReturnValue("uploads/owned.png");
    const fetcher = vi.fn().mockResolvedValueOnce(response); vi.stubGlobal("fetch", fetcher);
    await expect(requestProviderChat({ apiKey: "key", modelId: "gemini-3-6-flash-openai", messages })).rejects.toMatchObject({ outcome: "not_sent" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("caps streamed bytes even without a content length", async () => {
    storage.key.mockReturnValue("uploads/owned.png");
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8 * 1024 * 1024)); c.enqueue(new Uint8Array(1)); }, cancel });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    await expect(inlineAnalysisImages(messages, AbortSignal.timeout(1000))).rejects.toThrow("TOO_LARGE");
    expect(cancel).toHaveBeenCalled();
  });
  it("keeps existing inline image inputs and text-only calls off storage", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const input = [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${bytes.toString("base64")}` } }] }];
    expect(await inlineAnalysisImages(input, AbortSignal.timeout(1000))).toEqual(input);
    expect(await inlineAnalysisImages([{ role: "user", content: "text" }], AbortSignal.timeout(1000))).toEqual([{ role: "user", content: "text" }]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
