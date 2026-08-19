import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail, getBrief, getSearchResults } from "./shared";

const inputSchema = z.object({
  extraDirection: z.string().max(1000).optional(),
});

export const createVideoPromptTool: ToolDefinition = {
  name: "create_video_prompt",
  description:
    "Generate a production-ready video prompt: main prompt, negative prompt, shot list and style notes. Uses the brief and research from prior steps.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "create_video_prompt", "start");

    const brief = getBrief(ctx);
    const search = getSearchResults(ctx);
    if (!brief) return fail("No structured brief found. Run analyze_prompt_goal first.", "Missing brief.");

    const platform = String(brief.platform || "TikTok");
    const industry = String(brief.industry || "the product");
    const audience = String(brief.audience || "the audience");
    const objective = String(brief.creativeObjective || "showcase the product");
    const keywords = Array.isArray(search?.keywords) ? (search!.keywords as string[]) : [];

    const mainPrompt = [
      `Vertical 9:16 ${platform} ad for ${industry}.`,
      `Open on a relatable ${audience} person experiencing the exact pain point, 0-3 seconds, tight close-up, natural light.`,
      `Cut to the product in use with a macro close-up demonstrating the single key benefit.`,
      `Show an authentic reaction / visible result.`,
      `End on a clean product shot with a bold caption and a single CTA.`,
      `Style: authentic UGC, handheld realism, warm natural lighting, fast 1-2 second cuts, burned-in captions.`,
      keywords.length ? `Visual keywords: ${keywords.slice(0, 6).join(", ")}.` : "",
      parsed.data.extraDirection ? `Additional direction: ${parsed.data.extraDirection}` : "",
      `Objective: ${objective}`,
    ]
      .filter(Boolean)
      .join(" ");

    const negativePrompt =
      "blurry, low resolution, distorted faces, extra fingers, deformed hands, oversaturated, over-smoothed skin, watermark, logo artifacts, text gibberish, horizontal framing, slow pacing, studio fake look, misleading before/after";

    const shotList = [
      { shot: 1, duration: "0-2s", description: "Pain-point hook: close-up of the relatable problem, eye contact or hands.", camera: "Handheld close-up, shallow depth of field" },
      { shot: 2, duration: "2-5s", description: "Product reveal / application with macro texture detail.", camera: "Macro push-in, soft window light" },
      { shot: 3, duration: "5-9s", description: "Demonstration of the core benefit in a real context.", camera: "Medium over-shoulder, natural motion" },
      { shot: 4, duration: "9-12s", description: "Authentic reaction / result and social proof caption.", camera: "Front-facing medium shot" },
      { shot: 5, duration: "12-15s", description: "Product hero shot with offer and single CTA.", camera: "Locked-off product shot, clean background" },
    ];

    const styleNotes = [
      "9:16 vertical, 1080x1920, 5-15 seconds",
      "Authentic UGC tone over polished studio production",
      "Burned-in captions; reserve bottom 310px safe zone for UI",
      "One benefit, one CTA per ad",
      "Trending low-tempo audio; voice-over describing the pain and benefit",
    ];

    const videoPrompt = { mainPrompt, negativePrompt, shotList, styleNotes };
    ctx.sharedContext.videoPrompt = videoPrompt;

    await ctx.saveArtifact({
      type: "video_prompt",
      title: "Video Prompt",
      content: videoPrompt,
      metadata: { platform, industry, wordCount: mainPrompt.split(/\s+/).length },
    });
    await ctx.saveArtifact({
      type: "shot_list",
      title: "Shot List",
      content: { shots: shotList },
      metadata: { shotCount: shotList.length },
    });

    logTool(ctx, "create_video_prompt", "done");
    return ok(videoPrompt, `Generated a ${shotList.length}-shot prompt with negatives and style notes.`);
  },
};
