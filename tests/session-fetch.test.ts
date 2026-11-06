import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ACCESS_SESSION_REFRESH_REQUIRED } from "@/lib/auth/session-cookies";

const fetchMock = vi.fn<typeof fetch>();
let request: typeof import("@/lib/auth/session-fetch").fetchWithSessionRefresh;
const blocked = () => Response.json({ code: ACCESS_SESSION_REFRESH_REQUIRED }, { status: 401 });
beforeEach(async () => {
  vi.resetModules(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  request = (await import("@/lib/auth/session-fetch")).fetchWithSessionRefresh;
});
afterEach(() => vi.unstubAllGlobals());

it("renews a middleware-rejected poll and queries the same task once", async () => {
  fetchMock.mockResolvedValueOnce(blocked()).mockResolvedValueOnce(Response.json({ refreshed: true })).mockResolvedValueOnce(Response.json({ id: "task", state: "running" }));
  const path = "/api/commercial/tasks/task?diagnostics=1";
  const init = { cache: "no-store" as const };
  expect(await (await request(path, init)).json()).toMatchObject({ id: "task" });
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([path, "/api/session-refresh", path]);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
});

it("shares one renewal across simultaneous task and wallet polls", async () => {
  let finish!: (value: Response) => void;
  let renewed = false;
  const refreshing = new Promise<Response>(resolve => { finish = resolve; });
  fetchMock.mockImplementation(async input => input === "/api/session-refresh" ? refreshing : renewed ? Response.json({ ok: true }) : blocked());
  const polls = [request("/api/commercial/tasks/task"), request("/api/credits/me")];
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === "/api/session-refresh")).toHaveLength(1));
  renewed = true; finish(Response.json({ refreshed: true }));
  expect((await Promise.all(polls)).every(r => r.ok)).toBe(true);
  expect(fetchMock.mock.calls.filter(c => c[0] === "/api/session-refresh")).toHaveLength(1);
});

it("keeps a rejected paid confirmation's task ID and immutable body unchanged", async () => {
  fetchMock.mockResolvedValueOnce(blocked()).mockResolvedValueOnce(Response.json({ refreshed: true })).mockResolvedValueOnce(Response.json({ id: "same-task", state: "queued" }));
  const init = { method: "POST", body: JSON.stringify({ requestId: "unchanged" }) };
  await request("/api/commercial/tasks/same-task", init);
  expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[2]);
  expect(fetchMock.mock.calls.filter(c => c[1]?.method === "POST")).toHaveLength(3);
});

it.each([401, 403, 500])("does not replay an ordinary %i response without the middleware marker", async status => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: "Not confirmed" }, { status }));
  expect((await request("/api/commercial/tasks/paid", { method: "POST", body: "{}" })).status).toBe(status);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("does not replay an ambiguous network failure", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Connection interrupted"));
  await expect(request("/api/commercial/tasks/paid", { method: "POST", body: "{}" })).rejects.toThrow("Connection interrupted");
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each([401, 503])("does not replay a task after renewal returns %i", async status => {
  fetchMock.mockResolvedValueOnce(blocked()).mockResolvedValueOnce(Response.json({ code: "REFRESH_FAILED" }, { status }));
  expect((await request("/api/commercial/tasks/task")).status).toBe(status);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("bounds renewal and task replay even if cookies are not accepted", async () => {
  fetchMock.mockResolvedValueOnce(blocked()).mockResolvedValueOnce(Response.json({ refreshed: true })).mockResolvedValueOnce(blocked());
  expect((await request("/api/commercial/tasks/task")).status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("keeps transient renewal failures separate from an expired login", async () => {
  fetchMock.mockResolvedValueOnce(blocked()).mockRejectedValueOnce(new TypeError("Temporary refresh connection failure"));
  expect((await request("/api/commercial/tasks/task")).status).toBe(503);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not renew for another origin or resend a non-repeatable body", async () => {
  fetchMock.mockImplementation(async () => blocked());
  await request("https://other.example/api/task");
  await request("/api/media/resolve-link", { method: "POST", body: new FormData() });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not repeat an aborted task request after renewal", async () => {
  const controller = new AbortController();
  fetchMock.mockResolvedValueOnce(blocked()).mockImplementationOnce(async () => { controller.abort(); return Response.json({ refreshed: true }); });
  await expect(request("/api/commercial/tasks/task", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
