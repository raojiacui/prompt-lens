const labels = {
  zh: {
    projects: "我的项目", noProjects: "还没有项目", analysisModel: "分析模型",
    emptyTitle: "分析结果会显示在这里", emptyHint: "上传素材或粘贴视频链接，开始拆镜并提取提示词。",
    activeVersion: "当前版本", none: "暂无版本", scene: "镜头", seconds: "秒",
    prompt: "完整复刻提示词", rewrite: "AI 改写", rewriteLanguage: "改写输出语言",
    rewritePlaceholder: "例如：把人物换成红裙女子，氛围改得轻松一些，保留原来的运镜和节奏。",
    rewriteAction: "改写提示词", versions: "提示词版本", recreate: "做同款",
    outputLanguage: "结果语言", chinese: "中文", english: "英语",
    experimental: "试验版", preview: "素材预览",
    removeMedia: "移除素材", deleteProject: "删除项目", confirmDelete: "确定删除这个项目吗？删除后无法恢复。",
    backSamples: "返回样例", publicSample: "公开样例",
  },
  en: {
    projects: "Your projects", noProjects: "No projects yet", analysisModel: "Analysis model",
    emptyTitle: "Your analysis will appear here", emptyHint: "Upload a reference or paste a video link to extract shots and prompts.",
    activeVersion: "Current version", none: "No version yet", scene: "Shot", seconds: "s",
    prompt: "Recreation prompt", rewrite: "AI rewrite", rewriteLanguage: "Rewrite language",
    rewritePlaceholder: "Try a lighter mood or a new character while keeping the camera movement and timing.",
    rewriteAction: "Rewrite prompt", versions: "Prompt versions", recreate: "Create a variation",
    outputLanguage: "Output language", chinese: "Chinese", english: "English",
    experimental: "Experimental", preview: "Media preview",
    removeMedia: "Remove media", deleteProject: "Delete project", confirmDelete: "Delete this project? This cannot be undone.",
    backSamples: "Back to samples", publicSample: "Public sample",
  },
};

export function workspaceCopyFor(locale: string) {
  return locale === "en" ? labels.en : labels.zh;
}

export function localizedStatus(status: string | undefined, locale: string, fallbackAnalysis = false) {
  const zh = locale !== "en";
  if (status === "failed" && fallbackAnalysis) return zh ? "待复核" : "Needs review";
  const statuses: Record<string, [string, string]> = {
    draft: ["草稿", "Draft"], ready: ["已就绪", "Ready"], pending: ["等待处理", "Pending"],
    queued: ["排队中", "Queued"], processing: ["处理中", "Processing"],
    generating: ["生成中", "Generating"], uploading: ["上传中", "Uploading"],
    analyzing: ["分析中", "Analyzing"], completed: ["已完成", "Completed"],
    failed: ["失败", "Failed"], cancelled: ["已取消", "Cancelled"],
  };
  const pair = statuses[status || "ready"];
  return pair ? pair[zh ? 0 : 1] : (zh ? "状态待更新" : "Status unavailable");
}

export function localizedVersionLabel(version: { label: string; kind: string; versionNumber: number } | null | undefined, locale: string) {
  if (!version) return workspaceCopyFor(locale).none;
  const zh = locale !== "en";
  // Localize system-generated labels without rewriting user-created names.
  if (version.label === "Original" || version.label === "原始版本") return zh ? "原始版本" : "Original";
  if (/^(Rewrite|Remix)\s*\d*$/i.test(version.label)) return zh ? `改写版本 ${version.versionNumber}` : version.label;
  return version.label;
}
