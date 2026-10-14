import { expect, it, vi } from "vitest";
import { restoreGenerationSubmission, submitCommercialGeneration, type GenerationSubmissionBatch } from "@/lib/reference-video/commercial-generation-submit";

const batch = (): GenerationSubmissionBatch => ({ version: 1, request: { model: "test", userPrompt: "Cloud palace" }, quantity: 2, quotes: [], confirmationStarted: false });
const quote = (id: string) => Response.json({ id, credits: 20 });
const confirmation = () => Response.json({ tasks: [{ id: "one", state: "queued" }, { id: "two", state: "queued" }] });

it("quotes and submits every output in one action with one atomic confirmation", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quote("one")).mockResolvedValueOnce(quote("two")).mockResolvedValueOnce(confirmation());
  const persist = vi.fn();
  expect(await submitCommercialGeneration(batch(), true, persist, fetcher)).toEqual(["one", "two"]);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/commercial/generation", "/api/commercial/generation", "/api/commercial/confirm"]);
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({ ids: ["one", "two"] });
});

it("recovers a lost confirmation after reload using exactly the original task IDs", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quote("one")).mockResolvedValueOnce(quote("two")).mockRejectedValueOnce(new Error("response lost"));
  let saved = "";
  await expect(submitCommercialGeneration(batch(), true, value => { saved = JSON.stringify(value); }, fetcher)).rejects.toThrow("核对提交");
  const restored = restoreGenerationSubmission(saved)!;
  expect(restored.confirmationStarted).toBe(true);
  const retry = vi.fn<typeof fetch>().mockResolvedValueOnce(confirmation());
  expect(await submitCommercialGeneration(restored, true, vi.fn(), retry)).toEqual(["one", "two"]);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(JSON.parse(retry.mock.calls[0][1]!.body as string)).toEqual({ ids: ["one", "two"] });
});

it("keeps already obtained quotes when another output fails to quote", async () => {
  const current = batch();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quote("one")).mockResolvedValueOnce(Response.json({ code: "PREVIEW_RATE_LIMIT" }, { status: 400 }));
  await expect(submitCommercialGeneration(current, true, vi.fn(), fetcher)).rejects.toThrow("过于频繁");
  expect(current.quotes.map(quote => quote.id)).toEqual(["one"]);
  const retry = vi.fn<typeof fetch>().mockResolvedValueOnce(quote("two")).mockResolvedValueOnce(confirmation());
  expect(await submitCommercialGeneration(current, true, vi.fn(), retry)).toEqual(["one", "two"]);
  expect(retry).toHaveBeenCalledTimes(2);
});

it("does not turn a malformed confirmation into a second batch", async () => {
  const current = batch();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quote("one")).mockResolvedValueOnce(quote("two")).mockResolvedValueOnce(Response.json({ tasks: [] }));
  await expect(submitCommercialGeneration(current, true, vi.fn(), fetcher)).rejects.toThrow("核对提交");
  expect(current.confirmationStarted).toBe(true);
  expect(current.quotes.map(quote => quote.id)).toEqual(["one", "two"]);
});

it.each(["INSUFFICIENT_COMMERCIAL_BALANCE", "QUOTE_EXPIRED"])("unlocks a server-confirmed %s failure without automatic resubmission", async code => {
  const current = batch();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(quote("one")).mockResolvedValueOnce(quote("two")).mockResolvedValueOnce(Response.json({ code }, { status: 402 }));
  await expect(submitCommercialGeneration(current, true, vi.fn(), fetcher)).rejects.toThrow();
  expect(current.confirmationStarted).toBe(false);
  expect(current.quotes).toHaveLength(code === "QUOTE_EXPIRED" ? 0 : 2);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("rejects invalid restored batches", () => {
  expect(restoreGenerationSubmission("broken")).toBeNull();
  expect(restoreGenerationSubmission(JSON.stringify({ ...batch(), confirmationStarted: true }))).toBeNull();
  expect(restoreGenerationSubmission(JSON.stringify({ ...batch(), quotes: [{ id: "one", credits: -1 }] }))).toBeNull();
});
