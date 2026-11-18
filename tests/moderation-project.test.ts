import { afterEach, expect, it, vi } from "vitest";
import { isModerationProject } from "@/lib/safety/moderation-project";
import { requiresVideoOutputModeration } from "@/lib/safety/video-output-moderation";

afterEach(() => vi.unstubAllEnvs());
it.each([
  ["prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI", "production", true],
  ["prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI", "preview", true],
  ["prj_LA38e0saqqVw1OkQ95AyoMx5vjIV", "production", true],
  ["prj_LA38e0saqqVw1OkQ95AyoMx5vjIV", "preview", false],
  ["prj_LA38e0saqqVw1OkQ95AyoMx5vjIV", "development", false],
  ["unknown", "production", false],
])("enforces output moderation for project %s in %s: %s", (project, environment, expected) => {
  vi.stubEnv("VERCEL_PROJECT_ID", project);
  vi.stubEnv("VERCEL_ENV", environment);
  expect(isModerationProject()).toBe(expected);
  expect(requiresVideoOutputModeration()).toBe(expected);
});
