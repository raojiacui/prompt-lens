import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProjectList } from "@/lib/workflow/project-list-client";

afterEach(() => vi.unstubAllGlobals());
describe("project list recovery", () => {
  it("retries a temporary server error once without cached responses", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("server error", { status: 500 })).mockResolvedValueOnce(Response.json({ projects: [{ id: "saved" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchProjectList(false, true)).toEqual([{ id: "saved" }]);
    expect(fetch).toHaveBeenLastCalledWith("/api/workflow/projects?limit=20", { cache: "no-store" });
  });
  it("retries a network interruption once", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(Response.json({ projects: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchProjectList(false, true)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not retry an expired login or expose server errors", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchProjectList(false, true)).rejects.toThrow("登录状态已失效");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds retries and gives a readable localized message", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("private database details", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchProjectList(false, true)).rejects.toThrow("项目列表暂时无法加载");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not present invalid successful JSON as an empty history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: [] })));
    await expect(fetchProjectList(true, false)).rejects.toThrow("Projects are temporarily unavailable");
  });
});
