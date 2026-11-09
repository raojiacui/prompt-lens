import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  buildAlert,
  mergeActionableLogs,
  parseJsonLines,
} from "../scripts/vercel-log-report.mjs";

describe("parseJsonLines", () => {
  it("parses Vercel JSONL and ignores blank lines", () => {
    expect(
      parseJsonLines('{"level":"error","message":"boom"}\n\n'),
    ).toEqual([{ level: "error", message: "boom" }]);
  });

  it("unwraps typed Vercel records and ignores the pagination summary", () => {
    const output = [
      JSON.stringify({
        type: "log",
        data: {
          level: "error",
          message: "boom",
          deploymentId: "dpl_current",
        },
      }),
      JSON.stringify({ type: "summary", pagination: { next: null } }),
    ].join("\n");

    expect(parseJsonLines(output)).toEqual([{
      level: "error",
      message: "boom",
      deploymentId: "dpl_current",
    }]);
  });

  it("fails loudly when the CLI output is not valid JSONL", () => {
    expect(() => parseJsonLines("Not authorized")).toThrow(
      /invalid Vercel JSONL/i,
    );
  });
});

describe("mergeActionableLogs", () => {
  it("keeps errors, fatal entries and 5xx requests while excluding warnings and 4xx", () => {
    const entries = mergeActionableLogs([
      { level: "warning", statusCode: 429, message: "rate limited" },
      { level: "error", statusCode: 200, message: "KIE API error (524)" },
      { httpStatus: 502, message: "POST /api/analyze" },
      { level: "fatal", message: "worker crashed" },
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.message)).toEqual([
      "KIE API error (524)",
      "POST /api/analyze",
      "worker crashed",
    ]);
  });

  it("deduplicates the same request returned by both Vercel queries", () => {
    const duplicate = {
      id: "log_1",
      requestId: "req_1",
      level: "error",
      statusCode: 500,
      message: "failed",
      timestamp: 1792746000000,
    };

    expect(mergeActionableLogs([duplicate], [{ ...duplicate }])).toHaveLength(1);
  });
});

describe("buildAlert", () => {
  it("groups repeated signatures and includes operational collection failures", () => {
    const alert = buildAlert({
      logs: [
        {
          level: "error",
          statusCode: 500,
          path: "/api/analyze",
          message: "KIE API error (524): request abc123 failed",
          timestamp: "2026-10-23T01:00:00.000Z",
          deploymentId: "dpl_old",
        },
        {
          level: "error",
          statusCode: 500,
          path: "/api/analyze",
          message: "KIE API error (524): request def456 failed",
          timestamp: "2026-10-23T02:00:00.000Z",
          deploymentId: "dpl_old",
        },
      ],
      collectionFailures: ["5xx query: permission denied"],
      projectName: "prompt-lens",
    });

    expect(alert).not.toBeNull();
    expect(alert.subject).toContain("prompt-lens");
    expect(alert.text).toContain("/api/analyze");
    expect(alert.text).toContain("出现次数：2");
    expect(alert.text).toContain("Deployment ID：dpl_old");
    expect(alert.text).toContain("permission denied");
    expect(alert.text).toContain("请登录 Vercel");
  });

  it("returns null when there are no findings or collection failures", () => {
    expect(
      buildAlert({
        logs: [],
        collectionFailures: [],
        projectName: "prompt-lens",
      }),
    ).toBeNull();
  });

  it("creates a test email when manual verification is requested", () => {
    const alert = buildAlert({
      logs: [],
      collectionFailures: [],
      projectName: "prompt-lens",
      forceTest: true,
    });

    expect(alert).not.toBeNull();
    expect(alert.subject).toContain("邮件通道测试");
    expect(alert.text).toContain("测试邮件");
  });
});

describe("Vercel monitor workflow", () => {
  it("uses the Vercel 65 typed log commands and KQL filters", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/vercel-log-email-monitor.yml", import.meta.url),
      "utf8",
    );

    expect(workflow.replaceAll("\r\n", "\n")).toContain('logs runtime \\\n');
    expect(workflow).toContain("--query 'level:(error OR fatal)'");
    expect(workflow.replaceAll("\r\n", "\n")).toContain('logs requests \\\n');
    expect(workflow).toContain("--query 'httpStatus >= 500 AND httpStatus < 600'");
    expect(workflow).not.toContain("--branch main");
    expect(workflow).not.toContain("--level error");
    expect(workflow).not.toContain("--status-code 5xx");
  });

  it("uses half-hour rolling windows that fit the Hobby API retention", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/vercel-log-email-monitor.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain('- cron: "7,37 * * * *"');
    expect(workflow).toContain("printf 'since=30m\\nuntil=now\\n'");
    expect(workflow).not.toContain("window_end_epoch");
    expect(workflow).not.toContain('cron: "0 4 * * *"');
    expect(workflow).not.toContain('cron: "0 10 * * *"');
    expect(workflow).not.toContain("24 hours ago");
  });
});
