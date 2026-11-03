import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AnalysisTaskDetails } from "@/components/payments/analysis-task-details";
import { AnalysisTaskProgress } from "@/components/payments/analysis-task-progress";

it("shows recorded stages, separate sync/checkpoint times and missing timings", () => {
  const now = Date.now();
  const html = renderToStaticMarkup(<AnalysisTaskDetails taskId="test-task" zh lastSyncedAt={now} expanded diagnostics={{ taskId: "test-task", state: "running", stage: "preparing", observedAt: now, updatedAt: now - 180000, scenes: [{ index: 1, stage: "preparing" }, { index: 2, stage: "queued", queueMs: 12000 }] }} />);
  expect(html).toContain("后台任务详情"); expect(html).toContain("后台最近更新");
  expect(html).toContain("超过 2 分钟没有新检查点"); expect(html).toContain("等待调度");
  expect(html).toContain("0:12"); expect(html).toContain("—");
  expect(html).toContain('/billing/tasks/test-task');
});
it("marks auth failure as a stale snapshot and hides the progress estimate", () => {
  const html = renderToStaticMarkup(<AnalysisTaskDetails taskId="test-task" zh connection="auth" />);
  expect(html).toContain("登录校验失败"); expect(html).toContain("上次记录");
  const progress = renderToStaticMarkup(<AnalysisTaskProgress zh state="running" phase="preparing" total={10} finished={0} startedAt={Date.now()} connection="auth" />);
  expect(progress).toContain("后台进展尚未同步"); expect(progress).not.toContain("预计约");
});
