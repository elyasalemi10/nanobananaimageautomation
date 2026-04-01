export interface ReferenceImage {
  id: string;
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  name: string;
  size: number;
}

export interface PromptRow {
  id: string;
  prompt: string;
  referenceImages: ReferenceImage[];
  status: "idle" | "generating" | "completed" | "failed";
  resultImage?: string;
  resultMimeType?: string;
  error?: string;
}

export interface GenerationConfig {
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  resolution: "1K" | "2K" | "4K";
}

export interface QueueItem {
  id: string;
  prompt: string;
  referenceImages: ReferenceImage[];
  status: "queued" | "generating" | "completed" | "failed";
  resultImage?: string;
  resultMimeType?: string;
  error?: string;
  timestamp: number;
  config: GenerationConfig;
}
