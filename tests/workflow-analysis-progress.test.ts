import { expect, it } from "vitest";
import { workflowAnalysisPercent } from "@/lib/workflow/analysis-progress";

it("advances only on confirmed workflow checkpoints", () => {
  expect(workflowAnalysisPercent({ phase: "preparing", total: 0, finished: 0 })).toBe(60);
  expect(workflowAnalysisPercent({ phase: "analyzing", total: 1, finished: 0 })).toBe(65);
  expect(workflowAnalysisPercent({ phase: "analyzing", total: 2, finished: 1 })).toBe(80);
  expect(workflowAnalysisPercent({ phase: "saving", total: 2, finished: 2 })).toBe(95);
  expect(workflowAnalysisPercent({ phase: "analyzing", total: 1, finished: 5 })).toBe(95);
});
