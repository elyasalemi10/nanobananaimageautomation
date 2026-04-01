"use client";

import { useGeneration } from "@/context/GenerationContext";

export default function QueuePage() {
  const { queue } = useGeneration();

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
              <div className="flex gap-4">
                {/* Info */}
                <div className="flex-1 space-y-2">
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

                  {/* Reference image thumbnails */}
                  {item.referenceImages.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.referenceImages.map((img) => (
                        <img
                          key={img.id}
                          src={`data:${img.mimeType};base64,${img.base64}`}
                          alt={img.name}
                          className="h-10 w-10 rounded border border-neutral-700 object-cover"
                        />
                      ))}
                    </div>
                  )}

                  {item.error && (
                    <p className="text-xs text-red-400">{item.error}</p>
                  )}
                </div>

                {/* Result image */}
                <div className="flex w-40 items-center justify-center">
                  {item.status === "generating" && (
                    <svg className="h-8 w-8 animate-spin text-neutral-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {item.status === "completed" && item.resultImage && (
                    <img
                      src={`data:${item.resultMimeType};base64,${item.resultImage}`}
                      alt="Generated"
                      className="max-h-32 rounded-md border border-neutral-700"
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
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
