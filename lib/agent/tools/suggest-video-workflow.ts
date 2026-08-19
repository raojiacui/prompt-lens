import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail, getBrief, getSearchResults } from "./shared";

const inputSchema = z.object({
  includeLaunchSequence: z.boolean().optional(),
});

export const suggestVideoWorkflowTool: ToolDefinition = {
  name: "suggest_video_workflow",
  description:
    "Generate a video production workflow: ordered production steps, recommended generation settings and platform-specific advice.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "suggest_video_workflow", "start");

    const brief = getBrief(ctx);
    const search = getSearchResults(ctx);
    const platform = String(brief?.platform || "TikTok");
    const isLaunch = parsed.data.includeLaunchSequence === true || ctx.sharedContext.taskKind === "product_launch_video";

    const steps = isLaunch
      ? [
          "Day -3: publish a 6s teaser hinting at the problem and date",
          "Day 0: publish the 12-15s hero demo with offer",
          "Day 1-3: publish creator UGC / unboxing variants",
          "Day 4-14: retarget engaged viewers with testimonial and FAQ variants",
          "Refresh creative every 7 days to fight audience fatigue",
        ]
      : [
          "Lock the hook (0-3s) and single core benefit",
          "Generate the hero 9:16 clip from the video prompt (720p, 5-8s prospecting)",
          "Record or generate authentic voice-over describing pain + benefit",
          "Burn in captions and add a single end-card CTA",
          "A/B test two hooks before scaling budget",
        ];

    const recommendedSettings = {
      aspectRatio: "9:16 vertical",
      resolution: "720p generation (upscale to 1080x1920 on export)",
      duration: isLaunch ? "15s hero / 6s teaser" : "5-8s prospecting, up to 15s retargeting",
      frameRate: "24/30 fps",
      safeZone: "Keep key content out of the bottom 310px (captions + platform UI)",
      audio: "Trending low-tempo track or clear voice-over; -14 LUFS for social",
    };

    const platformAdvice: Record<string, string[]> = {
      TikTok: [
        "Hook in the first 3 seconds; show a face or hands immediately",
        "Native UGC outperforms polished ads",
        "Use burned-in captions; many view without sound",
      ],
      "Instagram Reels": [
        "Front-load brand color/mark in the first second",
        "Keep edits tight; use Reels-native audio where possible",
      ],
      "YouTube Shorts": [
        "Strong promise in the first 2 seconds",
        "Slightly longer 15-25s narratives perform well",
      ],
    };

    const advice = platformAdvice[platform] || platformAdvice["TikTok"];
    const searchRisks = Array.isArray(search?.risks) ? (search!.risks as string[]) : [];
    const notes = [...advice, ...searchRisks.slice(0, 2)];

    const workflow = {
      steps,
      recommendedSettings,
      platformAdvice: notes,
      nextAction: {
        label: "Generate the hero video now",
        description: "Create a video-generation task from the produced prompt (respects API key and rate limits).",
      },
    };

    ctx.sharedContext.workflow = workflow;

    await ctx.saveArtifact({
      type: "workflow",
      title: "Workflow Plan",
      content: workflow,
      metadata: { platform, launchSequence: isLaunch },
    });

    logTool(ctx, "suggest_video_workflow", "done");
    return ok(workflow, `Workflow with ${steps.length} steps for ${platform}.`);
  },
};
