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
import { QueueItem, ReferenceImage } from "@/types";

const STORAGE_KEY = "nano-banana-queue";
const MAX_STORED = 100;
const DELAY_BETWEEN_GENERATIONS_MS = 3000;

function loadQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const items = JSON.parse(data) as QueueItem[];
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
  referenceImages: ReferenceImage[]
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
      aspectRatio: "16:9",
      resolution: "2K",
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
  enqueueItems: (items: Array<{ prompt: string; referenceImages: ReferenceImage[] }>) => void;
  isProcessing: boolean;
}

const GenerationContext = createContext<GenerationContextType | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const processingRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Counter that increments to trigger the processor effect after each completion
  const [tick, setTick] = useState(0);

  // Load from localStorage on mount
  useEffect(() => {
    setQueue(loadQueue());
    setLoaded(true);
  }, []);

  // Save to localStorage when queue changes
  useEffect(() => {
    if (loaded) saveQueue(queue);
  }, [queue, loaded]);

  const enqueueItems = useCallback(
    (items: Array<{ prompt: string; referenceImages: ReferenceImage[] }>) => {
      const newItems: QueueItem[] = items.map((item) => ({
        id: crypto.randomUUID(),
        prompt: item.prompt,
        referenceImages: item.referenceImages,
        status: "queued" as const,
        timestamp: Date.now(),
        config: { aspectRatio: "16:9" as const, resolution: "2K" as const },
      }));
      setQueue((prev) => [...newItems, ...prev]);
    },
    []
  );

  // Queue processor — picks up one item at a time
  useEffect(() => {
    if (!loaded || processingRef.current) return;

    const nextItem = queue.find((item) => item.status === "queued");
    if (!nextItem) {
      setIsProcessing(false);
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);

    // Mark as generating
    setQueue((prev) =>
      prev.map((item) =>
        item.id === nextItem.id ? { ...item, status: "generating" as const } : item
      )
    );

    (async () => {
      try {
        const result = await callGenerateAPI(nextItem.prompt, nextItem.referenceImages);
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

      // Wait before allowing next item
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_GENERATIONS_MS));
      processingRef.current = false;
      // Bump tick to re-trigger this effect for the next queued item
      setTick((t) => t + 1);
    })();
  }, [queue, loaded, tick]);

  return (
    <GenerationContext.Provider value={{ queue, enqueueItems, isProcessing }}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration() {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used within GenerationProvider");
  return ctx;
}
