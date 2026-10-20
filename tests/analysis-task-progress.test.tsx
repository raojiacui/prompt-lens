import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalysisTaskProgress, getAnalysisProgressPercent } from "@/components/payments/analysis-task-progress";

describe("analysis task progress", () => {
  function render(state: string, phase: string, finished = 0, zh = true) {
    return renderToStaticMarkup(<AnalysisTaskProgress zh={zh} state={state} phase={phase} total={2} finished={finished} startedAt={Date.now()} />);
  }
  it("starts preparation visibly without inventing completed shots", () => {
    const html = render("running", "preparing");
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain("正在准备镜头素材");
    expect(html).toContain("已处理 0/2 个镜头");
    expect(html).toContain("参考估计");
  });
  it("advances from completed server checkpoints", () => {
    expect(render("running", "analyzing", 1)).toContain('aria-valuenow="55"');
    expect(render("queued", "saving", 2)).toContain('aria-valuenow="95"');
    expect(render("completed", "saving", 2)).toContain('aria-valuenow="100"');
  });
  it("moves evenly between checkpoints and stays below the next real checkpoint", () => {
    const atStart = getAnalysisProgressPercent({ state: "running", phase: "analyzing", total: 5, finished: 0, elapsedSinceCheckpoint: 0 });
    const afterOneMinute = getAnalysisProgressPercent({ state: "running", phase: "analyzing", total: 5, finished: 0, elapsedSinceCheckpoint: 60 });
    const afterTwoMinutes = getAnalysisProgressPercent({ state: "running", phase: "analyzing", total: 5, finished: 0, elapsedSinceCheckpoint: 120 });
    const nextCheckpoint = getAnalysisProgressPercent({ state: "running", phase: "analyzing", total: 5, finished: 1, elapsedSinceCheckpoint: 0 });
    expect(atStart).toBe(20);
    expect(afterOneMinute).toBeGreaterThan(atStart);
    expect(afterTwoMinutes).toBeGreaterThan(afterOneMinute);
    expect(afterTwoMinutes).toBeLessThan(nextCheckpoint);
  });
  it("does not present failure or review as still processing", () => {
    expect(render("failed", "preparing")).toContain("分析未完成");
    expect(render("failed", "preparing")).not.toContain("预计约");
    expect(render("review", "analyzing", 1)).toContain("不会重复扣款");
    expect(render("review", "analyzing", 1)).not.toContain("预计约");
  });
  it("supports English status and estimates", () => {
    expect(render("running", "analyzing", 1, false)).toContain('>Analyzing shots</p>');
    expect(render("running", "analyzing", 1, false)).toContain("approximate");
  });
});
