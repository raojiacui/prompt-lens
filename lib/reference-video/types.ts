export type TaskStatus =
  | "uploaded"
  | "analyzing"
  | "analysis_ready"
  | "storyboard_ready"
  | "generating"
  | "completed"
  | "failed";

export type UserAsset = {
  id: string;
  type: "product" | "person" | "logo" | "background" | "music" | "copy";
  name: string;
  preview?: string;
  serverAssetId?: string;
  uploadedUrl?: string;
  uploadStatus?: "empty" | "uploading" | "ready" | "failed";
  uploadError?: string;
};

export type GenerationVariant = {
  id: string;
  label: string;
  status: "queued" | "generating" | "completed" | "failed" | "pending";
  progress: number;
  videoUrl?: string;
  imageUrl?: string;
  providerTaskId?: string;
  error?: string;
  notes: string;
};

export type ReferenceVideoProject = {
  id: string;
  fileName: string;
  videoUrl: string;
  thumbnailUrl?: string;
  metadata: {
    duration?: number;
    width?: number;
    height?: number;
    aspectRatio?: string;
    fps?: number;
    hasAudio: boolean;
  };
  createdAt?: string;
};
