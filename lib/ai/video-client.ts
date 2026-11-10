import type { UserProvider } from "./providers";
import type { ReferenceMediaContext } from "./reference-media-access";
import { createInfistarVideo, getInfistarVideoStatus } from "./adapters/infistar-video";
import { createKieVeoGeneration, getKieVeoGenerationStatus, type KieVideoGenerationRequest } from "@/lib/reference-video/kie-veo";

export function createProviderVideo(provider: UserProvider, input: KieVideoGenerationRequest, apiKey: string, context?: ReferenceMediaContext) {
  return provider === "infistar" ? createInfistarVideo(input, apiKey, context) : createKieVeoGeneration(input, apiKey);
}
export function getProviderVideoStatus(provider: UserProvider, taskId: string, model: string | null | undefined, apiKey: string) {
  return provider === "infistar" ? getInfistarVideoStatus(taskId, apiKey) : getKieVeoGenerationStatus(taskId, model, apiKey);
}
