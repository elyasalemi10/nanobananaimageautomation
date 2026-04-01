"use client";

import { useCallback, useRef } from "react";
import { PromptRow as PromptRowType, ReferenceImage } from "@/types";

interface Props {
  row: PromptRowType;
  onUpdate: (id: string, updates: Partial<PromptRowType>) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
}

const MAX_IMAGES = 14;
const MAX_TOTAL_SIZE = 18 * 1024 * 1024; // 18MB warning threshold

export default function PromptRow({ row, onUpdate, onDelete, onRetry }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSize = row.referenceImages.reduce((sum, img) => sum + img.size, 0);
  const sizeWarning = totalSize > MAX_TOTAL_SIZE;

  const handleFiles = useCallback(
    async (files: FileList) => {
      const remaining = MAX_IMAGES - row.referenceImages.length;
      const toProcess = Array.from(files).slice(0, remaining);

      const newImages: ReferenceImage[] = await Promise.all(
        toProcess.map(
          (file) =>
            new Promise<ReferenceImage>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(",")[1];
                resolve({
                  id: crypto.randomUUID(),
                  base64,
                  mimeType: file.type as ReferenceImage["mimeType"],
                  name: file.name,
                  size: file.size,
                });
              };
              reader.readAsDataURL(file);
            })
        )
      );

      onUpdate(row.id, {
        referenceImages: [...row.referenceImages, ...newImages],
      });
    },
    [row.id, row.referenceImages, onUpdate]
  );

  const removeImage = useCallback(
    (imgId: string) => {
      onUpdate(row.id, {
        referenceImages: row.referenceImages.filter((img) => img.id !== imgId),
      });
    },
    [row.id, row.referenceImages, onUpdate]
  );

  const handleDownload = useCallback(() => {
    if (!row.resultImage || !row.resultMimeType) return;
    const ext = row.resultMimeType.split("/")[1] || "png";
    const link = document.createElement("a");
    link.href = `data:${row.resultMimeType};base64,${row.resultImage}`;
    link.download = `generated-${row.id.slice(0, 8)}.${ext}`;
    link.click();
  }, [row.resultImage, row.resultMimeType, row.id]);

  const isEditable = row.status === "idle" || row.status === "completed" || row.status === "failed";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex gap-4">
        {/* Left: Prompt + Reference images */}
        <div className="flex-1 space-y-3">
          <textarea
            value={row.prompt}
            onChange={(e) => onUpdate(row.id, { prompt: e.target.value })}
            disabled={!isEditable}
            placeholder="Enter your image generation prompt..."
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
            rows={3}
          />

          {/* Reference images */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isEditable || row.referenceImages.length >= MAX_IMAGES}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:text-white disabled:opacity-40"
              >
                + Add Reference Images
              </button>
              <span className="text-xs text-neutral-500">
                {row.referenceImages.length}/{MAX_IMAGES} reference images
              </span>
              {sizeWarning && (
                <span className="text-xs text-amber-400">
                  Warning: total size exceeds 18MB
                </span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            {row.referenceImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {row.referenceImages.map((img) => (
                  <div key={img.id} className="group relative">
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={img.name}
                      className="h-16 w-16 rounded-md border border-neutral-700 object-cover"
                    />
                    {isEditable && (
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Result or status */}
        <div className="flex w-48 flex-col items-center justify-center gap-2">
          {row.status === "generating" && (
            <div className="flex flex-col items-center gap-2 text-neutral-400">
              <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs">Generating...</span>
            </div>
          )}

          {row.status === "completed" && row.resultImage && (
            <div className="space-y-2">
              <img
                src={`data:${row.resultMimeType};base64,${row.resultImage}`}
                alt="Generated"
                className="max-h-40 rounded-md border border-neutral-700"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onRetry(row.id)}
                  className="rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:text-white"
                >
                  Retry
                </button>
                <button
                  onClick={handleDownload}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                >
                  Download
                </button>
              </div>
            </div>
          )}

          {row.status === "failed" && (
            <div className="space-y-2 text-center">
              <p className="text-xs text-red-400">{row.error || "Generation failed"}</p>
              <button
                onClick={() => onRetry(row.id)}
                className="rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:text-white"
              >
                Retry
              </button>
            </div>
          )}

          {row.status === "idle" && (
            <span className="text-xs text-neutral-600">Ready</span>
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={() => onDelete(row.id)}
          disabled={row.status === "generating"}
          className="self-start text-neutral-600 hover:text-red-400 disabled:opacity-30"
          title="Delete row"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}
