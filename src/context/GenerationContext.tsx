"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { QueueItem, GenerationConfig, ReferenceImage } from "@/types";

const STORAGE_KEY = "nano-banana-queue";
const MAX_STORED = 100;
const DELAY_BETWEEN_GENERATIONS_MS = 3000; // 3s gap between requests

function loadQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const items = JSON.parse(data) as QueueItem[];
    // Reset any "generating" items back to "queued" on reload
    return items.map((item) =>
      item.status === "generating" ? { ...item, status: "queued" as const } : item
    );
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(0, MAX_STORED)));
  } catch {
    // localStorage full or unavailable
  }
}

async function callGenerateAPI(
  prompt: string,
  referenceImages: ReferenceImage[],
  config: GenerationConfig
): Promise<{ image: string; mimeType: string }> {
  const res = await fetch("/api/gen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      referenceImages: referenceImages.map((img) => ({
        base64: img.base64,
        mimeType: img.mimeType,
      })),
      aspectRatio: config.aspectRatio,
      resolution: config.resolution,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(error.error || `Generation failed (${res.status})`);
  }

  return res.json();
}

interface GenerationContextType {
  queue: QueueItem[];
  config: GenerationConfig;
  setConfig: (config: GenerationConfig) => void;
  enqueueItems: (items: Array<{ prompt: string; referenceImages: ReferenceImage[] }>) => void;
  updateQueueItem: (id: string, updates: Partial<QueueItem>) => void;
  isProcessing: boolean;
}

const GenerationContext = createContext<GenerationContextType | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<GenerationConfig>({
    aspectRatio: "16:9",
    resolution: "2K",
  });
  const processingRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    setQueue(loadQueue());
    setLoaded(true);
  }, []);

  // Save to localStorage when queue changes
  useEffect(() => {
    if (loaded) saveQueue(queue);
  }, [queue, loaded]);

  const updateQueueItem = useCallback((id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const enqueueItems = useCallback(
    (items: Array<{ prompt: string; referenceImages: ReferenceImage[] }>) => {
      const newItems: QueueItem[] = items.map((item) => ({
        id: crypto.randomUUID(),
        prompt: item.prompt,
        referenceImages: item.referenceImages,
        status: "queued" as const,
        timestamp: Date.now(),
        config: { ...config },
      }));
      setQueue((prev) => [...newItems, ...prev]);
    },
    [config]
  );

  // Queue processor — runs in the context, survives page navigation
  useEffect(() => {
    if (!loaded) return;

    const processQueue = async () => {
      if (processingRef.current) return;

      const nextItem = queue.find((item) => item.status === "queued");
      if (!nextItem) return;

      processingRef.current = true;
      setIsProcessing(true);

      // Mark as generating
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id ? { ...item, status: "generating" as const } : item
        )
      );

      try {
        const result = await callGenerateAPI(
          nextItem.prompt,
          nextItem.referenceImages,
          nextItem.config
        );
        setQueue((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  status: "completed" as const,
                  resultImage: result.image,
                  resultMimeType: result.mimeType,
                }
              : item
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        setQueue((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? { ...item, status: "failed" as const, error: message }
              : item
          )
        );
      }

      // Wait before processing next to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_GENERATIONS_MS));
      processingRef.current = false;

      // Check if there are more queued items
      setIsProcessing(false);
    };

    processQueue();
  }, [queue, loaded]);

  return (
    <GenerationContext.Provider
      value={{ queue, config, setConfig, enqueueItems, updateQueueItem, isProcessing }}
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
