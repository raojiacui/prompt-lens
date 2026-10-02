import { describe, expect, it } from "vitest";
import { localizedStatus, localizedVersionLabel, workspaceCopyFor } from "../lib/workflow/interface-copy";

describe("localized interface copy", () => {
  it("has matching, independently written language sets", () => {
    expect(Object.keys(workspaceCopyFor("zh")).sort()).toEqual(Object.keys(workspaceCopyFor("en")).sort());
    for (const value of Object.values(workspaceCopyFor("zh"))) expect(value).toMatch(/[\u4e00-\u9fff]/);
    for (const value of Object.values(workspaceCopyFor("en"))) expect(value).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it("localizes statuses and unknown values without leaking internal codes", () => {
    expect(localizedStatus("ready", "zh")).toBe("已就绪");
    expect(localizedStatus("failed", "zh", true)).toBe("待复核");
    expect(localizedStatus("completed", "en")).toBe("Completed");
    expect(localizedStatus("internal_state", "zh")).toBe("状态待更新");
  });
  it("localizes default version labels but preserves custom names", () => {
    expect(localizedVersionLabel({ label: "Original", kind: "original", versionNumber: 1 }, "zh")).toBe("原始版本");
    expect(localizedVersionLabel({ label: "Remix 2", kind: "rewrite", versionNumber: 2 }, "zh")).toBe("改写版本 2");
    expect(localizedVersionLabel({ label: "My own story", kind: "rewrite", versionNumber: 3 }, "zh")).toBe("My own story");
  });
});
