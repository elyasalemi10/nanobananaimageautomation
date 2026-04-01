"use client";

import { useState, useCallback } from "react";
import { PromptRow as PromptRowType, ReferenceImage } from "@/types";
import { useGeneration } from "@/context/GenerationContext";
import GenerationConfig from "@/components/GenerationConfig";
import PromptRow from "@/components/PromptRow";

function createEmptyRow(): PromptRowType {
  return {
    id: crypto.randomUUID(),
    prompt: "",
    referenceImages: [],
    status: "idle",
  };
}

async function loadHenryPreset(): Promise<ReferenceImage> {
  const res = await fetch("/henry.PNG");
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve({
        id: "henry-preset",
        base64,
        mimeType: "image/png",
        name: "henry.PNG",
        size: blob.size,
      });
    };
    reader.readAsDataURL(blob);
  });
}

export default function GeneratePage() {
  const { config, addToQueue, updateQueueItem, generateImage } = useGeneration();
  const [rows, setRows] = useState<PromptRowType[]>([createEmptyRow()]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [henryActive, setHenryActive] = useState(false);
  const [henryImage, setHenryImage] = useState<ReferenceImage | null>(null);

  const updateRow = useCallback((id: string, updates: Partial<PromptRowType>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...updates } : row))
    );
  }, []);

  const deleteRow = useCallback((id: string) => {
    setRows((prev) => {
      const filtered = prev.filter((row) => row.id !== id);
      return filtered.length === 0 ? [createEmptyRow()] : filtered;
    });
  }, []);

  const toggleHenryPreset = useCallback(async () => {
    if (henryActive) {
      // Remove henry from all rows
      setRows((prev) =>
        prev.map((row) => ({
          ...row,
          referenceImages: row.referenceImages.filter((img) => img.id !== "henry-preset"),
        }))
      );
      setHenryActive(false);
    } else {
      // Load henry and add to all rows
      let img = henryImage;
      if (!img) {
        img = await loadHenryPreset();
        setHenryImage(img);
      }
      setRows((prev) =>
        prev.map((row) => {
          const hasHenry = row.referenceImages.some((r) => r.id === "henry-preset");
          if (hasHenry) return row;
          return { ...row, referenceImages: [...row.referenceImages, img] };
        })
      );
      setHenryActive(true);
    }
  }, [henryActive, henryImage]);

  const generateRow = useCallback(
    async (row: PromptRowType) => {
      const queueId = row.id;

      addToQueue({
        id: queueId,
        prompt: row.prompt,
        referenceImages: row.referenceImages,
        status: "generating",
        timestamp: Date.now(),
        config: { ...config },
      });

      updateRow(row.id, { status: "generating", error: undefined });

      try {
        const result = await generateImage(row.prompt, row.referenceImages, config);
        updateRow(row.id, {
          status: "completed",
          resultImage: result.image,
          resultMimeType: result.mimeType,
        });
        updateQueueItem(queueId, {
          status: "completed",
          resultImage: result.image,
          resultMimeType: result.mimeType,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        updateRow(row.id, { status: "failed", error: message });
        updateQueueItem(queueId, { status: "failed", error: message });
      }
    },
    [config, addToQueue, updateRow, updateQueueItem, generateImage]
  );

  const handleRetry = useCallback(
    (id: string) => {
      updateRow(id, { status: "idle", resultImage: undefined, resultMimeType: undefined, error: undefined });
    },
    [updateRow]
  );

  const handleGenerateAll = useCallback(async () => {
    const validRows = rows.filter((row) => row.prompt.trim() && row.status !== "generating");
    if (validRows.length === 0) return;

    setIsGenerating(true);
    // Generate sequentially to respect rate limits
    for (const row of validRows) {
      await generateRow(row);
    }
    setIsGenerating(false);
  }, [rows, generateRow]);

  const hasValidRows = rows.some((row) => row.prompt.trim());
  const hasGenerating = rows.some((row) => row.status === "generating");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Model badge */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Image Generation</h1>
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
          Model: Nano Banana 2 (gemini-3.1-flash-image-preview)
        </span>
      </div>

      <GenerationConfig />

      {/* Preset buttons */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-neutral-500">Presets:</span>
        <button
          onClick={toggleHenryPreset}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            henryActive
              ? "bg-blue-600 text-white"
              : "border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white"
          }`}
        >
          {henryActive ? "Henry ✓" : "Select Henry"}
        </button>
      </div>

      {/* Rows */}
      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id}>
            <div className="mb-1 text-xs text-neutral-500">Row {index + 1}</div>
            <PromptRow
              row={row}
              onUpdate={updateRow}
              onDelete={deleteRow}
              onRetry={handleRetry}
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={() => {
            const newRow = createEmptyRow();
            // If henry is active, add it to the new row
            if (henryActive && henryImage) {
              newRow.referenceImages = [henryImage];
            }
            setRows((prev) => [...prev, newRow]);
          }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white"
        >
          + Add Row
        </button>
        <button
          onClick={handleGenerateAll}
          disabled={!hasValidRows || hasGenerating || isGenerating}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {isGenerating ? "Generating..." : "Generate All"}
        </button>
      </div>
    </div>
  );
}
