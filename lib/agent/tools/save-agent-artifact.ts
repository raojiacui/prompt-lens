import { z } from "zod";
import type { ToolDefinition } from "../types";
import { logTool, ok, fail, getBrief } from "./shared";

const inputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  note: z.string().max(2000).optional(),
});

/**
 * save_agent_artifact
 *
 * 其他工具已经在产出时通过 ctx.saveArtifact 保存各自的 artifact。
 * 本工具负责在 run 末尾保存一份"最终汇总"artifact：把 brief / research /
 * prompt / workflow 整合成一个可保存、可复制的最终交付物，并生成 next actions。
 */
export const saveAgentArtifactTool: ToolDefinition = {
  name: "save_agent_artifact",
  description:
    "Persist a final consolidated deliverable (summary, next actions) for the run. Also used to ensure all produced assets are saved as artifacts.",
  inputSchema,
  async execute(raw, ctx) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return fail("Invalid input: " + parsed.error.errors[0]?.message);
    logTool(ctx, "save_agent_artifact", "start");

    const brief = getBrief(ctx);
    const report = (ctx.sharedContext.researchReport as Record<string, unknown>) || null;
    const videoPrompt = (ctx.sharedContext.videoPrompt as Record<string, unknown>) || null;
    const workflow = (ctx.sharedContext.workflow as Record<string, unknown>) || null;

    const title = parsed.data.title || "Agent Run Summary";

    const summary = {
      goal: ctx.sharedContext.goal || "",
      brief,
      hasResearchReport: Boolean(report),
      hasVideoPrompt: Boolean(videoPrompt),
      hasWorkflow: Boolean(workflow),
      highlights: {
        reportSummary: report?.summary ?? null,
        promptPreview: videoPrompt?.mainPrompt
          ? String(videoPrompt.mainPrompt).slice(0, 240)
          : null,
        workflowSteps: Array.isArray(workflow?.steps) ? (workflow!.steps as string[]).slice(0, 5) : [],
      },
      note: parsed.data.note || "All deliverables for this agent run.",
    };

    const artifact = await ctx.saveArtifact({
      type: "summary",
      title,
      content: summary,
      metadata: {
        artifactKinds: ["research_report", "video_prompt", "shot_list", "workflow", "risk_notes"].filter((k) => {
          if (k === "research_report") return Boolean(report);
          if (k === "video_prompt" || k === "shot_list") return Boolean(videoPrompt);
          if (k === "workflow") return Boolean(workflow);
          if (k === "risk_notes") return Boolean(report);
          return false;
        }),
      },
    });

    // 单独存一份 next actions
    await ctx.saveArtifact({
      type: "next_actions",
      title: "Recommended Next Actions",
      content: {
        actions: [
          videoPrompt
            ? { label: "Generate the hero video", action: "video_generate", description: "Create a video task from the produced prompt (uses existing video-gen API and rate limits)." }
            : null,
          { label: "Copy the video prompt", action: "copy_prompt", description: "Copy mainPrompt and negativePrompt to your clipboard." },
          { label: "Save to history / mark favorite", action: "save_history", description: "Keep this run in your history for reuse." },
          { label: "Refine the goal and re-run", action: "refine_goal", description: "Tweak the goal and run the agent again for a different angle." },
        ].filter(Boolean),
      },
      metadata: {},
    });

    // 如果有 report，单独存一份 risk notes
    if (report && Array.isArray(report.riskNotes)) {
      await ctx.saveArtifact({
        type: "risk_notes",
        title: "Risk Notes",
        content: { riskNotes: report.riskNotes },
        metadata: {},
      });
    }

    logTool(ctx, "save_agent_artifact", "done", { artifactId: artifact.id });
    return ok({ artifactId: artifact.id, summary }, `Saved final deliverable "${title}".`);
  },
};
