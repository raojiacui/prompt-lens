import { resolveLinkedMediaWithEasyDown } from "./easydown";

export async function resolveLinkedMedia(url: string) {
  return resolveLinkedMediaWithEasyDown(url);
}
