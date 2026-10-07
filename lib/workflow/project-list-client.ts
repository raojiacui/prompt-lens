export async function fetchProjectList<T>(force: boolean, zh: boolean): Promise<T[]> {
  const unavailable = zh ? "项目列表暂时无法加载，请点击刷新重试。" : "Projects are temporarily unavailable. Refresh to retry.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/workflow/projects?limit=20", { cache: force || attempt ? "no-store" : "default" });
      if (response.status === 401) throw new Error(zh ? "登录状态已失效，请重新登录。" : "Your session expired. Sign in again.");
      if (attempt === 0 && response.status >= 500) {
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      if (!response.ok) throw new Error(unavailable);
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.projects)) throw new Error(unavailable);
      return data.projects;
    } catch (error) {
      if (attempt === 0 && error instanceof TypeError) {
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      throw error instanceof TypeError ? new Error(unavailable) : error;
    }
  }
  throw new Error(unavailable);
}
