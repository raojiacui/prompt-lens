import { requestKieChat } from "./kie-client";
import { requestInfistarChat } from "./infistar-client";
import type { UserProvider } from "./providers";
import { inlineAnalysisImages } from "./analysis-images";
import { KieRequestError } from "./kie-client";

export async function requestProviderChat(input: Parameters<typeof requestKieChat>[0] & { provider?: UserProvider }) {
  const startedAt = Date.now();
  const budget = input.timeoutMs ?? 180_000;
  let messages;
  try { messages = await inlineAnalysisImages(input.messages, AbortSignal.timeout(budget)); }
  catch (error) { throw new KieRequestError("Analysis image preparation failed", undefined, "not_sent", error); }
  const remaining = budget - (Date.now() - startedAt);
  if (remaining <= 0) throw new KieRequestError("Analysis image preparation timed out", undefined, "not_sent");
  const prepared = { ...input, messages, timeoutMs: remaining };
  return input.provider === "infistar" ? requestInfistarChat(prepared) : requestKieChat(prepared);
}
