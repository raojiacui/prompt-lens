import { expect, it, vi } from "vitest";

it("disabled media features cannot fetch arbitrary URLs or call providers", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not fetch"));
  try {
    const routes = await Promise.all([
      import("@/app/api/audio-clip/route"), import("@/app/api/audio-analyze/route"),
      import("@/app/api/video-edit/route"), import("@/app/api/workflow/projects/[id]/audio/route"),
      import("@/app/api/workflow/projects/[id]/edit/route"),
    ]);
    for (const route of routes) {
      const response = await route.POST();
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: "FEATURE_NOT_AVAILABLE" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});
