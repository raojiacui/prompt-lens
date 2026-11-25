import { NextResponse } from "next/server";
const headers = { "Cache-Control": "private, no-store" };
export function scriptError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const errors: Record<string, [number, string, boolean]> = {
    SCRIPT_NOT_FOUND: [404, "脚本不存在或内容已过期 / Script not found or expired", true],
    SCRIPT_NO_SCENES: [409, "暂无可整理的镜头 / No scenes available", true],
    SCRIPT_CONFLICT: [409, "脚本已有新修订，请保留本地稿并处理冲突 / A newer revision exists", true],
    SCRIPT_BOUNDARY_MISMATCH: [400, "镜头与时间点不可更改 / Scene boundaries cannot be changed", true],
    SCRIPT_INVALID_SCOPE: [400, "请选择有效镜头 / Select valid scenes", true],
    SCRIPT_NO_REVISION: [409, "暂无可恢复的修订 / No revision to restore", true],
    SCRIPT_REPLAY_MISMATCH: [409, "请求内容与原请求不一致 / Request replay mismatch", true],
    "Task quote replay mismatch": [409, "请求内容与原请求不一致 / Request replay mismatch", true],
    SCRIPT_REWRITE_BUSY: [409, "已有脚本改写处理中 / Another rewrite is processing", true],
    REWRITE_IN_PROGRESS: [409, "改写仍在处理中，稍后查询不会重复扣次数 / Rewrite processing; retry to retrieve", false],
    SCRIPT_RESULT_UNAVAILABLE: [409, "原请求已结束，当前结果不可用，请检查脚本后重新提交 / Previous request ended; check the script before resubmitting", true],
    SCRIPT_REWRITE_FAILED: [502, "AI 改写未完成，预留次数已释放，原稿保留 / Rewrite failed; reserved allowance released", true],
    INSUFFICIENT_COMMERCIAL_BALANCE: [402, "套餐改写次数不足 / No included rewrites left", true],
    COMMERCIAL_WALLET_UNDER_REVIEW: [403, "账户权益审核中 / Account allowance under review", true],
  };
  const known = errors[code];
  return NextResponse.json({ code: known ? code : "SCRIPT_STATUS_UNKNOWN", error: known?.[1] ?? "暂时无法确认结果，请稍后重试 / Unable to confirm; retry later", final: known?.[2] ?? false }, { status: known?.[0] ?? 503, headers });
}
