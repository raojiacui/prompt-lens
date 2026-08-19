import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail, getBrief, getSearchResults } from "./shared";

const inputSchema = z.object({
  note: z.string().max(2000).optional(),
});

export const generateResearchReportTool: ToolDefinition = {
  name: "generate_research_report",
  description:
    "Combine the structured brief and search results into a research report: summary, opportunities, creative angles and risk notes.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "generate_research_report", "start");

    const brief = getBrief(ctx);
    const search = getSearchResults(ctx);
    if (!brief) {
      return fail("No structured brief found. Run analyze_prompt_goal first.", "Missing brief.");
    }

    const sources = Array.isArray(search?.sources) ? (search!.sources as Array<Record<string, unknown>>) : [];
    const trends = Array.isArray(search?.trends) ? (search!.trends as string[]) : [];
    const opportunities = Array.isArray(search?.opportunities) ? (search!.opportunities as string[]) : [];
    const risks = Array.isArray(search?.risks) ? (search!.risks as string[]) : [];
    const keywords = Array.isArray(search?.keywords) ? (search!.keywords as string[]) : [];

    const platform = String(brief.platform || "short-form video");
    const industry = String(brief.industry || "the category");
    const audience = String(brief.audience || "the target audience");

    const report = {
      summary: `For ${industry} on ${platform}, the strongest creative direction pairs a pain-point-first hook with an authentic demonstration aimed at ${audience}. Current winning patterns favor ${trends.slice(0, 2).join("; ") || "fast, vertical, caption-led storytelling"}.`,
      opportunities: opportunities.length
        ? opportunities
        : [
            "Lead with a specific pain point the product resolves in the first 3 seconds",
            "Use a single benefit claim per ad for clarity",
            "Pair a real creator face with a product close-up",
          ],
      creativeAngles: [
        `Problem → demo → result: open on the ${industry.toLowerCase()} pain, show the product in use, end on the outcome`,
        `Creator testimonial: a relatable ${audience} voice describing the before/after`,
        `Macro/texture close-up with a single bold claim and a burned-in caption`,
      ],
      riskNotes: risks.length
        ? risks
        : [
            "Avoid absolute or medical claims that require substantiation",
            "Keep before/after honest to reduce moderation risk",
            "Reserve a bottom safe zone for platform UI/captions",
          ],
      keywords,
      sources: sources.slice(0, 6).map((s) => ({
        title: s.title,
        url: s.url,
        snippet: s.snippet,
        publishedAt: s.publishedAt,
        confidence: s.confidence,
      })),
      note: search?.note || "Compiled from mock search results.",
    };

    ctx.sharedContext.researchReport = report;

    // 同时保存为 artifact
    await ctx.saveArtifact({
      type: "research_report",
      title: "Research Report",
      content: report,
      metadata: { sourceCount: sources.length, platform, industry },
    });

    logTool(ctx, "generate_research_report", "done");
    return ok(report, `Report with ${report.opportunities.length} opportunities and ${report.riskNotes.length} risk notes.`);
  },
};
