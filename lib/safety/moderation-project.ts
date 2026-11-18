/** Mandatory safety gates on the isolated test project and the authorized live release. */
export function isModerationProject(): boolean {
  const projectId = process.env.VERCEL_PROJECT_ID;
  return projectId === "prj_wGvOLlXsOzpVUGZiK3spsAIxXAjI" ||
    (projectId === "prj_LA38e0saqqVw1OkQ95AyoMx5vjIV" && process.env.VERCEL_ENV === "production");
}
