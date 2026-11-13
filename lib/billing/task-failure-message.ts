import { analysisFailureMessage } from "./analysis-failure-message";

export type TaskFailureContext = {
  failureCode?: unknown;
  chargedCredits?: number;
  partial?: boolean;
  payer?: "platform" | "byok";
};

export function taskSyncInterruptedMessage(language: string) {
  return language === "en"
    ? "Status sync interrupted. Reconnecting to the same task; do not resubmit."
    : "任务状态同步中断，正在重新连接同一任务，请勿重复提交。";
}

/** Only confirmed terminal failures reach this formatter. Polling errors keep polling. */
export function taskFailureMessage(context: TaskFailureContext, language: string) {
  const en = language === "en";
  const { failureCode, chargedCredits, partial, payer } = context;
  const reason = analysisFailureMessage(failureCode, language)
    || (failureCode === "PROVIDER_MODEL_FAILED" || failureCode === "PROVIDER_MODEL_UNAVAILABLE"
      ? (en ? "The upstream model service failed. Try again with another model." : "供应商上游模型服务错误，可以换个模型再试一次。")
      : failureCode === "PROVIDER_ACCOUNT_REJECTED"
        ? (en ? "The provider rejected account access. Check credentials and provider balance." : "供应商账户校验未通过，请检查密钥及上游账户余额。")
        : failureCode === "PROVIDER_REQUEST_REJECTED"
          ? (en ? "The provider rejected the request. Check the input and model settings before retrying." : "供应商未接受本次请求，请检查素材和模型参数后重试。")
          : partial
            ? (en ? "Some shots did not complete. Check failed-shot details before retrying." : "部分镜头未完成，请查看失败镜头详情后重试。")
            : (en ? "The task did not complete. Check task details before retrying." : "任务未完成，请查看任务详情后重试。"));
  const delivery = partial
    ? (en ? "Successful shots are preserved; failed shots do not consume platform credits." : "成功镜头已保留，失败镜头不扣平台积分。")
    : "";
  const billing = payer === "byok"
    ? (en ? "No platform inference credits are charged; provider costs follow your own account's bill." : "模型调用不扣平台推理积分，供应商费用以你自己的账户账单为准。")
      + (typeof chargedCredits === "number" && chargedCredits > 0 ? (en ? ` Delivered platform services settled ${chargedCredits} credits.` : ` 已交付的平台服务结算 ${chargedCredits} 积分。`) : "")
    : chargedCredits === 0
      ? (en ? "No credits were charged for this task; reserved credits have been released." : "本次未扣积分，预留额度已释放。")
      : typeof chargedCredits === "number" && chargedCredits > 0
        ? (en ? `${chargedCredits} credits settled for delivered work. Check task details for the breakdown.` : `已交付部分结算 ${chargedCredits} 积分，明细可在任务详情查看。`)
        : (en ? "Settlement is not yet confirmed. Check the original task for updates." : "结算状态尚未确认，请在原任务中查看更新。");
  return [reason, delivery, billing].filter(Boolean).join(" ");
}
