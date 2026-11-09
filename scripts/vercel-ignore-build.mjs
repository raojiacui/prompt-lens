const projects = new Set([
  "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI",
  "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV",
]);

const build = projects.has(process.env.VERCEL_PROJECT_ID)
  && process.env.VERCEL_ENV === "production"
  && process.env.VERCEL_GIT_COMMIT_REF === "prompt-lens-V2";

// Vercel's Ignored Build Step uses 0 to skip and 1 to continue.
console.log(build ? "Continue V2 Git production build" : "Skip build outside approved V2 projects, branch or environment");
process.exit(build ? 1 : 0);
