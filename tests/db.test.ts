import { describe, it, expect } from "vitest";
import { extractCorePrompt } from "@/lib/ai/analyzer";

describe("AI Analyzer", () => {
  it("should extract core prompt from result", () => {
    const result = `
这是分析结果...

核心提示词：一辆红色汽车在高速公路上行驶

──────────────────────────────────────────────

🎬 主体详细：
• 人物：无
• 动作：...
`;

    const corePrompt = extractCorePrompt(result);
    expect(corePrompt).toContain("红色汽车");
  });

  it("should handle result without explicit core prompt", () => {
    const result = `
第一行内容
第二行内容
`;

    const corePrompt = extractCorePrompt(result);
    expect(corePrompt).toBe("第一行内容");
  });
});

describe("Utils", () => {
  it("should format date correctly", () => {
    const { formatDate } = require("@/lib/utils");
    const date = new Date("2024-01-01T12:00:00Z");
    const formatted = formatDate(date);
    expect(formatted).toContain("2024");
  });

  it("should format file size correctly", () => {
    const { formatFileSize } = require("@/lib/utils");
    expect(formatFileSize(1024)).toContain("KB");
    expect(formatFileSize(1024 * 1024)).toContain("MB");
  });

  it("should truncate string correctly", () => {
    const { truncate } = require("@/lib/utils");
    expect(truncate("hello world", 5)).toBe("hello...");
    expect(truncate("hi", 10)).toBe("hi");
  });
});
