const PRODUCTION_PROJECT = "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV";
const TEST_PROJECT = "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI";

const projectId = process.env.VERCEL_PROJECT_ID;
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const target = process.env.VERCEL_ENV;

// Vercel's Ignored Build Step: 0 = SKIP, 1 = continue.
// The production project must NEVER build staging branches.
// The test project must NEVER build production branch pushes.
const build = (
  projectId === PRODUCTION_PROJECT && branch === "prompt-lens-V2" && target === "production"
) || (
  projectId === TEST_PROJECT && branch === "staging/v2" &&
  (target === "production" || target === "preview")
);

console.log(build
  ? `Continue isolated ${projectId === TEST_PROJECT ? "staging" : "production"} build`
  : "Skip build outside approved project, branch or environment");
process.exit(build ? 1 : 0);
