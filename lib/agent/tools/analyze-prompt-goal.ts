import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail } from "./shared";

const inputSchema = z.object({
  userGoal: z.string().min(1).max(2000),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        size: z.number(),
      })
    )
    .optional(),
});

interface StructuredBrief {
  industry: string;
  platform: string;
  audience: string;
  creativeObjective: string;
  assetNeeds: string[];
  productName: string | null;
  hasMedia: boolean;
}

function inferIndustry(goal: string): string {
  const q = goal.toLowerCase();
  if (/skincar|护肤|beauty|cosmetic|serum|moistur/.test(q)) return "Skincare / Beauty";
  if (/fashion|apparel|clothing|服装|服饰/.test(q)) return "Fashion / Apparel";
  if (/food|drink|beverage|snack|餐饮|食品|饮料/.test(q)) return "Food & Beverage";
  if (/fitness|supplement|gym|健身|保健/.test(q)) return "Fitness & Supplements";
  if (/tech|gadget|app|saas|software|科技|软件/.test(q)) return "Tech / SaaS";
  if (/home|furniture|decor|家居/.test(q)) return "Home & Lifestyle";
  return "General consumer";
}

function inferPlatform(goal: string): string {
  const q = goal.toLowerCase();
  if (/tiktok|抖音/.test(q)) return "TikTok";
  if (/reel|instagram/.test(q)) return "Instagram Reels";
  if (/youtube|shorts/.test(q)) return "YouTube Shorts";
  if (/facebook/.test(q)) return "Facebook";
  return "TikTok (short-form vertical)";
}

function inferAudience(goal: string): string {
  const q = goal.toLowerCase();
  if (/teen|gen ?z|young/.test(q)) return "Gen Z (16-24)";
  if (/millennial|young professional/.test(q)) return "Millennials (25-40)";
  if (/mom|family|parent/.test(q)) return "Parents / families";
  if (/men|male/.test(q)) return "Male-focused audience";
  if (/women|female/.test(q)) return "Female-focused audience";
  return "Broad category-interested audience (18-45)";
}

function buildBrief(goal: string, attachments: Array<{ name: string; type: string; size: number }>): StructuredBrief {
  const productMatch = goal.match(/(?:for|my|our)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s&'\-]{1,40}?)(?:\.|,|\s+(?:ad|video|product|brand|launch|on|for)|$)/);
  return {
    industry: inferIndustry(goal),
    platform: inferPlatform(goal),
    audience: inferAudience(goal),
    creativeObjective: goal.slice(0, 200),
    assetNeeds: [
      "vertical 9:16 hero video (5-15s)",
      "hook-first 3-second opening",
      "burned-in captions",
      "clear end-card CTA",
    ],
    productName: productMatch ? productMatch[1].trim() : null,
    hasMedia: attachments.length > 0,
  };
}

export const analyzePromptGoalTool: ToolDefinition = {
  name: "analyze_prompt_goal",
  description:
    "Analyze the user goal and extract industry, target platform, audience, creative objective and required assets into a structured brief.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("Invalid goal input: " + parsed.error.errors[0]?.message);
    }
    logTool(ctx, "analyze_prompt_goal", "start");

    try {
      const attachments = parsed.data.attachments ?? ctx.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size }));
      const brief = buildBrief(parsed.data.userGoal, attachments);
      ctx.sharedContext.brief = brief;

      logTool(ctx, "analyze_prompt_goal", "done", { industry: brief.industry, platform: brief.platform });
      return ok({ structuredBrief: brief }, `Brief: ${brief.industry} for ${brief.audience} on ${brief.platform}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Goal analysis failed";
      logTool(ctx, "analyze_prompt_goal", "error", message);
      return fail(message, "Could not analyze the goal.");
    }
  },
};
