"use client";

import { AgentStepCard } from "./agent-step-card";
import type { AgentRunDetail } from "@/lib/agent/types";

export function AgentPlanTimeline({ run }: { run: AgentRunDetail }) {
  if (run.steps.length === 0) {
    return (
      <div className="rounded-2xl border border-[#E4E2DD] bg-white/60 p-6 text-center text-sm text-[#6B6860]">
        Generating your plan…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E4E2DD] bg-white/60 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[#141413]" style={{ fontFamily: "var(--font-heading)" }}>
          Execution plan
        </h3>
        <span className="text-xs text-[#9C9890]">{run.steps.length} steps</span>
      </div>
      <div>
        {run.steps.map((step, i) => (
          <AgentStepCard
            key={step.id}
            step={step}
            toolCalls={run.toolCalls}
            isLast={i === run.steps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
