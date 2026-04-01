"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { QueueItem, GenerationConfig, ReferenceImage } from "@/types";

interface GenerationContextType {
  queue: QueueItem[];
  addToQueue: (item: QueueItem) => void;
  updateQueueItem: (id: string, updates: Partial<QueueItem>) => void;
  config: GenerationConfig;
  setConfig: (config: GenerationConfig) => void;
  generateImage: (
    prompt: string,
    referenceImages: ReferenceImage[],
    config: GenerationConfig
  ) => Promise<{ image: string; mimeType: string }>;
}

const GenerationContext = createContext<GenerationContextType | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [config, setConfig] = useState<GenerationConfig>({
    aspectRatio: "16:9",
    resolution: "2K",
  });

  const addToQueue = useCallback((item: QueueItem) => {
    setQueue((prev) => [item, ...prev]);
  }, []);

  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const generateImage = useCallback(
    async (
      prompt: string,
      referenceImages: ReferenceImage[],
      cfg: GenerationConfig
    ): Promise<{ image: string; mimeType: string }> => {
      const res = await fetch("/api/gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          referenceImages: referenceImages.map((img) => ({
            base64: img.base64,
            mimeType: img.mimeType,
          })),
          aspectRatio: cfg.aspectRatio,
          resolution: cfg.resolution,
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(error.error || `Generation failed (${res.status})`);
      }

      return res.json();
    },
    []
  );

  return (
    <GenerationContext.Provider
      value={{ queue, addToQueue, updateQueueItem, config, setConfig, generateImage }}
    >
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration() {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used within GenerationProvider");
  return ctx;
}
