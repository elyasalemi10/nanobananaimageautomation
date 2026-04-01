"use client";

import { useState } from "react";
import { useGeneration } from "@/context/GenerationContext";
import ImagePreview from "@/components/ImagePreview";

export default function QueuePage() {
  const { queue } = useGeneration();
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-6 text-xl font-bold">Generation Queue</h1>

      {queue.length === 0 ? (
        <p className="text-neutral-500">
          No generations yet. Go to Generate to create some images.
        </p>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-neutral-800 bg-neutral-950 p-4"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-neutral-500">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-xs text-neutral-600">
                    {item.config.aspectRatio} &middot; {item.config.resolution}
                  </span>
                </div>
                <p className="text-sm text-neutral-300">{item.prompt}</p>

                {item.referenceImages.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.referenceImages.map((img) => (
                      <img
                        key={img.id}
                        src={`data:${img.mimeType};base64,${img.base64}`}
                        alt={img.name}
                        className="h-10 w-10 cursor-pointer rounded border border-neutral-700 object-cover"
                        onClick={() => setPreviewSrc(`data:${img.mimeType};base64,${img.base64}`)}
                      />
                    ))}
                  </div>
                )}

                {item.error && (
                  <p className="text-xs text-red-400">{item.error}</p>
                )}
              </div>

              {item.status === "generating" && (
                <div className="mt-3 flex items-center gap-2 text-neutral-400">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs">Generating...</span>
                </div>
              )}

              {item.status === "completed" && item.resultImage && (
                <div className="mt-3 border-t border-neutral-800 pt-3">
                  <img
                    src={`data:${item.resultMimeType};base64,${item.resultImage}`}
                    alt="Generated"
                    className="w-full cursor-pointer rounded-md border border-neutral-700"
                    onClick={() => setPreviewSrc(`data:${item.resultMimeType};base64,${item.resultImage}`)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {previewSrc && (
        <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-neutral-800 text-neutral-400",
    generating: "bg-yellow-900/50 text-yellow-400",
    completed: "bg-green-900/50 text-green-400",
    failed: "bg-red-900/50 text-red-400",
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}
