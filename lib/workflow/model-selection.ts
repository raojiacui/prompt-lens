import type { ModelPriority, ModelSelectionMode } from "@/lib/ai/model-registry";

export interface ParsedWorkflowModelSelection {
  modelMode: ModelSelectionMode;
  modelId?: string;
  modelPriority: ModelPriority;
}

const modelPriorities = new Set<ModelPriority>(["fast", "balanced", "best_quality", "lowest_cost"]);

export function parseWorkflowModelSelection(body: unknown): ParsedWorkflowModelSelection {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const modelMode = record.modelMode === "manual" ? "manual" : "auto";
  const modelId = typeof record.modelId === "string" && record.modelId.trim() ? record.modelId.trim() : undefined;
  const modelPriority =
    typeof record.modelPriority === "string" && modelPriorities.has(record.modelPriority as ModelPriority)
      ? (record.modelPriority as ModelPriority)
      : "balanced";

  return { modelMode, modelId, modelPriority };
}
