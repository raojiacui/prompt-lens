import { requestKieChat } from "./kie-client";
import { requestInfistarChat } from "./infistar-client";
import type { UserProvider } from "./providers";

export function requestProviderChat(input: Parameters<typeof requestKieChat>[0] & { provider?: UserProvider }) {
  return input.provider === "infistar" ? requestInfistarChat(input) : requestKieChat(input);
}
