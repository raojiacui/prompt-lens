declare module "whisper-node" {
  export class Whisper {
    constructor();
    loadModel(modelSize?: string): Promise<void>;
    transcribe(audioPath: string): Promise<{
      text: string;
      language?: string;
      duration?: number;
    }>;
  }
}
