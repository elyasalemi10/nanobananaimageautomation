"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { QueueItem, GenerationConfig, ReferenceImage } from "@/types";

const STORAGE_KEY = "nano-banana-queue";
const MAX_STORED = 100;

function loadQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as QueueItem[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueItem[]) {
  try {
    // Only persist completed/failed items, up to MAX_STORED
    const toStore = queue
      .filter((item) => item.status === "completed" || item.status === "failed")
      .slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

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
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<GenerationConfig>({
    aspectRatio: "16:9",
    resolution: "2K",
  });

  // Load from localStorage on mount
  useEffect(() => {
    setQueue(loadQueue());
    setLoaded(true);
  }, []);

  // Save to localStorage when queue changes
  useEffect(() => {
    if (loaded) saveQueue(queue);
  }, [queue, loaded]);

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
