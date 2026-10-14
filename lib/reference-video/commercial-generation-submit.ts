export type GenerationQuote = { id: string; credits: number };
export type GenerationSubmissionBatch = {
  version: 1;
  request: Record<string, unknown>;
  quantity: number;
  quotes: GenerationQuote[];
  confirmationStarted: boolean;
};

export function restoreGenerationSubmission(value: string | null): GenerationSubmissionBatch | null {
  try {
    const batch = JSON.parse(value || "null") as GenerationSubmissionBatch | null;
    if (!batch || batch.version !== 1 || !batch.request || typeof batch.request !== "object" || Array.isArray(batch.request)
      || !Number.isInteger(batch.quantity) || batch.quantity < 1 || batch.quantity > 4
      || typeof batch.confirmationStarted !== "boolean" || !Array.isArray(batch.quotes)
      || batch.quotes.length > batch.quantity || new Set(batch.quotes.map(quote => quote?.id)).size !== batch.quotes.length
      || !batch.quotes.every(quote => typeof quote?.id === "string" && quote.id.length > 0 && Number.isSafeInteger(quote.credits) && quote.credits >= 0)
      || (batch.confirmationStarted && batch.quotes.length !== batch.quantity)) return null;
    return batch;
  } catch { return null; }
}

function quoteError(code: unknown, zh: boolean) {
  const messages: Record<string, [string, string]> = {
    MODEL_PRICE_UNVERIFIED: ["该模型暂未核价，请换一个模型。", "Choose a model with verified pricing."],
    PAID_MODEL_NOT_VERIFIED: ["请选择有效的视频生成或编辑模型。", "Choose an available generation or editing model."],
    PAID_GENERATION_CONFIGURATION_UNSUPPORTED: ["当前模型不支持这组素材、时长或画质，请调整参数。", "Adjust the inputs, duration or quality for this model."],
    PAID_GENERATION_ASPECT_UNSUPPORTED: ["请选择模型支持的比例。", "Choose an aspect ratio supported by this model."],
    UPLOAD_NOT_OWNED: ["请使用当前账户上传的参考视频。", "Use a reference video uploaded by your account."],
    INSUFFICIENT_COMMERCIAL_BALANCE: ["积分不足，本次未启动生成。", "Insufficient credits. No generation started."],
    PREVIEW_RATE_LIMIT: ["参考视频报价过于频繁，请稍后再试。", "Too many reference-video quotes. Try again later."],
    MEDIA_PROBE_NOT_CONFIGURED: ["参考视频时长检测暂不可用。", "Reference-video probing is unavailable."],
  };
  return messages[String(code)]?.[zh ? 0 : 1] || (zh ? "暂时无法获取费用，请稍后重试。未扣积分。" : "Unable to obtain the cost. Try again later. No credits charged.");
}

/** One user action obtains server quotes and confirms the same batch atomically. */
export async function submitCommercialGeneration(
  batch: GenerationSubmissionBatch,
  zh: boolean,
  persist: (batch: GenerationSubmissionBatch) => void,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  while (batch.quotes.length < batch.quantity) {
    const response = await fetcher("/api/commercial/generation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch.request),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(quoteError(body?.code, zh));
    if (!body || typeof body.id !== "string" || !body.id || batch.quotes.some(quote => quote.id === body.id)
      || !Number.isSafeInteger(body.credits) || body.credits < 0) {
      throw new Error(zh ? "费用响应不完整，尚未启动生成，请重试。" : "Incomplete cost response. Generation has not started; retry.");
    }
    batch.quotes.push({ id: body.id, credits: body.credits });
    persist(batch);
  }
  const ids = batch.quotes.map(quote => quote.id);
  batch.confirmationStarted = true;
  persist(batch); // Keep IDs before submission, including when its response is lost.
  try {
    const response = await fetcher("/api/commercial/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && ["INSUFFICIENT_COMMERCIAL_BALANCE", "QUOTE_EXPIRED"].includes(body?.code)) {
        batch.confirmationStarted = false;
        if (body.code === "QUOTE_EXPIRED") batch.quotes = [];
        persist(batch);
        throw new Error(body.code === "QUOTE_EXPIRED"
          ? (zh ? "费用已过期，请再次点击生成获取最新费用。" : "The cost expired. Click generate again to refresh it.")
          : quoteError(body.code, zh));
      }
      throw new Error("GENERATION_CONFIRMATION_UNCERTAIN");
    }
    if (!Array.isArray(body?.tasks) || body.tasks.length !== ids.length
      || !ids.every(id => body.tasks.some((task: { id?: unknown; state?: unknown }) => task.id === id && typeof task.state === "string"))) {
      throw new Error("GENERATION_CONFIRMATION_UNCERTAIN");
    }
    return ids;
  } catch (error) {
    if (!batch.confirmationStarted) throw error;
    throw new Error(zh ? "提交状态暂未确认。再次点击“核对提交”会查询同一批任务，不会重复生成。" : "Submission is unconfirmed. Click Check submission to verify the same tasks without creating another batch.");
  }
}
