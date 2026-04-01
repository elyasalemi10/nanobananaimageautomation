"use client";

import { useState, useCallback } from "react";
import { PromptRow as PromptRowType } from "@/types";
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

export default function GeneratePage() {
  const { config, addToQueue, updateQueueItem, generateImage } = useGeneration();
  const [rows, setRows] = useState<PromptRowType[]>([createEmptyRow()]);
  const [isGenerating, setIsGenerating] = useState(false);

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

  const generateRow = useCallback(
    async (row: PromptRowType) => {
      const queueId = row.id;

      // Add to queue
      addToQueue({
        id: queueId,
        prompt: row.prompt,
        referenceImages: row.referenceImages,
        status: "generating",
        timestamp: Date.now(),
        config: { ...config },
      });

      // Update row status
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
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      // Reset to idle so user can edit, then they can hit Generate All or we auto-submit
      updateRow(id, { status: "idle", resultImage: undefined, resultMimeType: undefined, error: undefined });
    },
    [rows, updateRow]
  );

  const handleGenerateAll = useCallback(async () => {
    const validRows = rows.filter((row) => row.prompt.trim() && row.status !== "generating");
    if (validRows.length === 0) return;

    setIsGenerating(true);

    // Fire all rows concurrently
    await Promise.allSettled(validRows.map((row) => generateRow(row)));

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
          Model: Nano Banana 2 (imagen-3.0-generate-002) via Vertex AI
        </span>
      </div>

      <GenerationConfig />

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
          onClick={() => setRows((prev) => [...prev, createEmptyRow()])}
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
