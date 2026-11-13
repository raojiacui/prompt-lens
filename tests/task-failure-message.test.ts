import { describe, expect, it } from "vitest";
import { taskFailureMessage, taskSyncInterruptedMessage } from "@/lib/billing/task-failure-message";

describe("failure guidance and billing evidence", () => {
  it("suggests another model for confirmed upstream failure and reports zero settlement", () => {
    const message = taskFailureMessage({ failureCode: "PROVIDER_MODEL_FAILED", chargedCredits: 0 }, "zh");
    expect(message).toContain("供应商上游模型服务错误");
    expect(message).toContain("换个模型");
    expect(message).toContain("本次未扣积分");
  });
  it("does not promise free execution without settlement confirmation", () => {
    const message = taskFailureMessage({ failureCode: "PROVIDER_MODEL_FAILED" }, "zh");
    expect(message).toContain("结算状态尚未确认");
    expect(message).not.toContain("本次未扣积分");
    expect(message).not.toContain("已释放");
  });
  it("preserves partial delivery charges", () => {
    const message = taskFailureMessage({ partial: true, chargedCredits: 7 }, "zh");
    expect(message).toContain("成功镜头已保留");
    expect(message).toContain("结算 7 积分");
    expect(message).not.toContain("本次未扣积分");
  });
  it("distinguishes BYOK supplier costs and paid splitting", () => {
    const message = taskFailureMessage({ payer: "byok", partial: true, chargedCredits: 5 }, "zh");
    expect(message).toContain("自己的账户账单");
    expect(message).toContain("平台服务结算 5 积分");
    expect(message).not.toContain("本次未扣积分");
  });
  it.each(["MEDIA_DOWNLOAD_FAILED", "KIE_KEY_REQUIRED", "PROVIDER_ACCOUNT_REJECTED", "PROVIDER_REQUEST_REJECTED", undefined])("does not blame model service for %s", failureCode => {
    expect(taskFailureMessage({ failureCode, chargedCredits: 0 }, "zh")).not.toContain("上游模型服务错误");
  });
  it("keeps synchronization interruptions on the original task without a no-charge claim", () => {
    expect(taskSyncInterruptedMessage("zh")).toContain("同一任务，请勿重复提交");
    expect(taskSyncInterruptedMessage("zh")).not.toContain("未扣");
    expect(taskSyncInterruptedMessage("en")).toContain("do not resubmit");
  });
  it("offers model retry for invalid analysis but checks the original interrupted task", () => {
    expect(taskFailureMessage({ failureCode: "KIE_INVALID_RESULT", chargedCredits: 0 }, "zh")).toContain("更换模型");
    expect(taskFailureMessage({ failureCode: "ANALYSIS_INTERRUPTED" }, "zh")).toContain("确认失败后再重试");
  });
  it("supports English failure and billing guidance", () => {
    const message = taskFailureMessage({ failureCode: "PROVIDER_MODEL_FAILED", chargedCredits: 0 }, "en");
    expect(message).toContain("another model");
    expect(message).toContain("No credits were charged");
  });
});
