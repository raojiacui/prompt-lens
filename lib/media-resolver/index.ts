import { resolveLinkedMediaWithEasyDown } from "./easydown";
import { resolveLinkedMediaWithLeaperOne } from "./leaperone";

export async function resolveLinkedMedia(url: string) {
  if (process.env.EASYDOWN_API_KEY?.trim()) return resolveLinkedMediaWithEasyDown(url);
  return resolveLinkedMediaWithLeaperOne(url);
}
