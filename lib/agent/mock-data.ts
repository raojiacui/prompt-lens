/**
 * 集中式 mock 数据 —— 仅供 web_search_mock 等 mock 工具使用。
 *
 * 真实搜索服务（Tavily / Exa / SerpAPI / Bing）接入后，本文件可整体下线，
 * 只要新工具保持相同的输出结构即可。
 */

export interface MockSearchSource {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string;
  confidence: number; // 0..1
  insightTags: string[];
}

export interface MockSearchResult {
  query: string;
  market: string;
  platform: string;
  locale: string;
  sources: MockSearchSource[];
  keywords: string[];
  trends: string[];
  opportunities: string[];
  risks: string[];
  searchQueryVariations: string[];
  note: string;
}

/**
 * 根据查询意图选择不同的 mock 结果集，让不同任务类型看起来都像真的搜过。
 * 这里不做真实网络请求，结果是确定性的（同一 query 产生同一结果），便于测试与演示。
 */
export function runMockSearch(input: {
  query: string;
  market?: string;
  platform?: string;
  locale?: string;
}): MockSearchResult {
  const query = (input.query || "").trim();
  const market = input.market || "global";
  const platform = (input.platform || detectPlatform(query)).toLowerCase();
  const locale = input.locale || "en";
  const q = query.toLowerCase();

  const sources: MockSearchSource[] = [];
  const keywords = new Set<string>();
  const trends: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];

  const push = (s: MockSearchSource) => sources.push(s);
  const kw = (...items: string[]) => items.forEach((i) => keywords.add(i));
  const tr = (...items: string[]) => trends.push(...items);
  const op = (...items: string[]) => opportunities.push(...items);
  const rk = (...items: string[]) => risks.push(...items);

  // —— 趋势/爆款类 ——
  if (q.includes("trend") || q.includes("viral") || q.includes("爆款") || q.includes("趋势") || q.includes("tiktok") || q.includes("skincare") || q.includes("护肤")) {
    push({
      title: `${platform.toUpperCase()} Creative Center: Top performing skincare ad formats Q3`,
      url: `https://www.${platform}.com/business/creative-center/top-ads/skincare`,
      snippet:
        "Hook-first 3-second openings showing visible skin texture transformation drive 2.3x higher 6-second retention. UGC-style creator testimonials outperform studio productions in the beauty category.",
      publishedAt: "2026-06-18",
      confidence: 0.91,
      insightTags: ["hook-first", "ugc", "beauty", "retention"],
    });
    push({
      title: "Why 'before/after' skincare ads are taking over short-form feeds",
      url: "https://blog.example-marketing.com/skincare-before-after-ads",
      snippet:
        "Macro close-ups of pores, texture and application with voice-over describing the exact problem convert best. Adding a limited-time discount overlay in the last 2 seconds lifts CTR.",
      publishedAt: "2026-05-29",
      confidence: 0.83,
      insightTags: ["before-after", "macro", "voiceover", "cta"],
    });
    push({
      title: `${platform} ad library: 40 rising skincare creatives analyzed`,
      url: "https://ads.example.com/library/skincare-rising-creatives",
      snippet:
        "Common structure: pain point (0-2s) → ingredient demo (2-5s) → texture close-up (5-8s) → social proof (8-11s) → offer (11-13s). Vertical 9:16, captions burned in, trending low-tempo audio.",
      publishedAt: "2026-07-02",
      confidence: 0.78,
      insightTags: ["structure", "9:16", "captions", "audio"],
    });
    kw("visible transformation", "ugc testimonial", "macro close-up", "before after", "pore texture", "9:16 vertical", "hook in 3s", "burned captions");
    tr("3-second pain-point hooks", "authentic creator UGC over studio ads", "ingredient-led demos", "short 12-15s durations with end-card offer");
    op("pair a real creator face with a macro texture shot", "lead with a relatable pain point the product solves", "add a clear before/after with honest disclosure");
    rk("before/after claims can trigger platform moderation", "over-edited skin may be flagged as misleading", "medical claims require substantiation");
  }

  // —— 竞品拆解类 ——
  if (q.includes("competitor") || q.includes("竞品") || q.includes("拆解") || q.includes("analyze") || q.includes("analysis")) {
    push({
      title: "Competitor ad teardown: hero product creative patterns",
      url: "https://www.example-insights.com/competitor-teardown",
      snippet:
        "The leading competitor uses a consistent 4-beat structure across 30+ variants: relatable hook, single-benefit claim, demonstration, and a single CTA. Brand color appears in the first 0.5s.",
      publishedAt: "2026-06-10",
      confidence: 0.8,
      insightTags: ["teardown", "structure", "branding", "cta"],
    });
    kw("4-beat structure", "single benefit", "brand color", "consistent hook", "variant testing");
    tr("consistent templated structure across variants", "single-benefit messaging", "fast A/B hook testing");
    op("reuse their 4-beat rhythm but differentiate with authentic creators", "test a stronger product-demo beat");
    rk("copying exact creative may look derivative", "competitor may have trademarked hooks/slogans");
  }

  // —— 产品发布类 ——
  if (q.includes("launch") || q.includes("发布") || q.includes("上线") || q.includes("product")) {
    push({
      title: "Product launch video playbook: teaser → demo → UGC → retargeting",
      url: "https://www.example-launch.com/playbook",
      snippet:
        "Sequenced launch funnel: a 6s teaser 3 days before launch, a 15s hero demo on launch day, then UGC and unboxing variants for retargeting over 14 days.",
      publishedAt: "2026-04-22",
      confidence: 0.79,
      insightTags: ["launch", "funnel", "teaser", "ugc", "retargeting"],
    });
    push({
      title: "Specs and settings that perform for launch creatives",
      url: "https://www.example-launch.com/specs",
      snippet:
        "9:16 vertical, 1080x1920, 5-8 seconds for prospecting, 15 seconds for retargeting. Reserve a 310px bottom safe zone for captions and UI. 720p generation is sufficient for social.",
      publishedAt: "2026-07-08",
      confidence: 0.84,
      insightTags: ["9:16", "1080x1920", "safe-zone", "720p"],
    });
    kw("teaser", "hero demo", "unboxing", "9:16", "safe zone", "retargeting", "launch funnel");
    tr("phased creative rollout", "short teasers before launch day", "UGC for the retargeting phase");
    op("plan a 4-asset sequence instead of one hero video", "keep launch day ad under 15s");
    rk("generation quotas/rate limits on video providers", "audience fatigue if same creative runs >7 days");
  }

  // —— 视频 prompt / 生成类 ——
  if (q.includes("prompt") || q.includes("generate") || q.includes("生成") || q.includes("video") || q.includes("shot")) {
    push({
      title: "High-performing text-to-video prompts for product ads",
      url: "https://www.example-prompts.com/video-prompt-patterns",
      snippet:
        "Effective prompts specify: subject, action, camera movement, lens/focal length, lighting, environment, aspect ratio and motion pace. Negative prompts reduce distortion and extra fingers.",
      publishedAt: "2026-05-15",
      confidence: 0.82,
      insightTags: ["prompt-structure", "camera", "lighting", "negative-prompt"],
    });
    kw("subject + action", "camera movement", "focal length", "lighting", "aspect ratio", "negative prompt", "motion pace");
    tr("camera-driven prompts (dolly/orbit) perform better than static shots", "explicit lighting keywords improve realism", "negative prompts stabilize faces/hands");
    op("break the brief into a shot list of 3-5 prompts", "add one motion verb per shot");
    rk("overloaded prompts produce incoherent motion", "brand logos may render incorrectly — add to negative prompt");
  }

  // —— 通用兜底：至少返回一些合理结果 ——
  if (sources.length === 0) {
    push({
      title: `Industry snapshot: ${query || "creative strategy"}`,
      url: "https://www.example.com/industry-snapshot",
      snippet:
        "Short-form creative continues to favor authentic, fast-cut content with clear hooks, benefit-led demos and strong end-card CTAs. Vertical 9:16 and burned-in captions are standard.",
      publishedAt: "2026-07-01",
      confidence: 0.7,
      insightTags: ["short-form", "hook", "vertical", "captions"],
    });
    kw("clear hook", "benefit demo", "9:16", "cta");
    tr("authentic creator style", "fast cuts", "vertical video");
    op("lead with a hook and a single benefit");
    rk("generic creative may underperform without a clear audience");
  }

  return {
    query,
    market,
    platform,
    locale,
    sources,
    keywords: Array.from(keywords),
    trends,
    opportunities,
    risks,
    searchQueryVariations: [
      query,
      `${query} ${platform} ad examples`,
      `${query} best performing creatives`,
      `${query} ${new Date().getFullYear()} trends`,
    ].filter(Boolean),
    note: "Results generated by web_search_mock (deterministic sample data). Swap for Tavily/Exa/SerpAPI/Bing in production.",
  };
}

function detectPlatform(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("tiktok")) return "tiktok";
  if (q.includes("reel") || q.includes("instagram")) return "instagram";
  if (q.includes("youtube") || q.includes("shorts")) return "youtube";
  if (q.includes("facebook")) return "facebook";
  return "tiktok";
}

/** 用于 existing_history_lookup 工具的 mock 历史记录（当真实查询无结果时兜底） */
export const MOCK_HISTORY_SUGGESTIONS = [
  {
    title: "Reuse a previous video analysis",
    snippet: "You analyzed a similar competitor ad last week — its shot list and hook structure can be reused.",
  },
  {
    title: "Reuse a generated video prompt",
    snippet: "A prior video-generation prompt used the same 9:16 product demo setup; copy its negative prompt.",
  },
];
