export function alipayQueryErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/验签|signature|validateSign/i.test(message)) return "ALIPAY_SIGNATURE_INVALID";
  if (/timeout|timed out|超时/i.test(message)) return "ALIPAY_QUERY_TIMEOUT";
  return "ALIPAY_QUERY_UNAVAILABLE";
}
