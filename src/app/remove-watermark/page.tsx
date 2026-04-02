"use client";

import { useState, useCallback, useRef } from "react";
import ImagePreview from "@/components/ImagePreview";

interface ProcessedImage {
  id: string;
  originalName: string;
  originalUrl: string;
  resultUrl?: string;
  status: "queued" | "processing" | "done" | "failed";
  error?: string;
}

export default function RemoveWatermarkPage() {
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [modelBuffer, setModelBuffer] = useState<ArrayBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  // File storage (not in state to avoid serialization issues)
  const fileMap = useRef(new Map<string, File>()).current;

  const handleFilesWrapped = useCallback(
    (fileList: FileList) => {
      const newImages: ProcessedImage[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file.type.startsWith("image/")) continue;
        const id = crypto.randomUUID();
        fileMap.set(id, file);
        newImages.push({
          id,
          originalName: file.name,
          originalUrl: URL.createObjectURL(file),
          status: "queued",
        });
      }
      setImages((prev) => [...prev, ...newImages]);
    },
    [fileMap]
  );

  const processAll = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    // Load model if not cached
    let buffer = modelBuffer;
    if (!buffer) {
      setModelProgress(0);
      const { loadModel } = await import("@/lib/watermark-remover");
      buffer = await loadModel((pct) => setModelProgress(pct));
      setModelBuffer(buffer);
      setModelProgress(null);
    }

    const { removeWatermark } = await import("@/lib/watermark-remover");

    // Process each queued image sequentially
    const queued = images.filter((img) => img.status === "queued");
    for (const img of queued) {
      const file = fileMap.get(img.id);
      if (!file) continue;

      setImages((prev) =>
        prev.map((i) => (i.id === img.id ? { ...i, status: "processing" as const } : i))
      );

      try {
        const blob = await removeWatermark(file, buffer!, (status) => {
          setImages((prev) =>
            prev.map((i) =>
              i.id === img.id ? { ...i, status: "processing" as const, error: status } : i
            )
          );
        });

        const resultUrl = URL.createObjectURL(blob);
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? { ...i, status: "done" as const, resultUrl, error: undefined }
              : i
          )
        );
      } catch (err) {
        setImages((prev) =>
          prev.map((i) =>
            i.id === img.id
              ? { ...i, status: "failed" as const, error: err instanceof Error ? err.message : "Failed" }
              : i
          )
        );
      }
    }

    processingRef.current = false;
    setIsProcessing(false);
  }, [images, modelBuffer, fileMap]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        handleFilesWrapped(e.dataTransfer.files);
      }
    },
    [handleFilesWrapped]
  );

  const handleDownload = useCallback((img: ProcessedImage) => {
    if (!img.resultUrl) return;
    const a = document.createElement("a");
    a.href = img.resultUrl;
    const name = img.originalName.replace(/\.[^.]+$/, "");
    a.download = `${name}-no-watermark.png`;
    a.click();
  }, []);

  const handleDownloadAll = useCallback(() => {
    const done = images.filter((img) => img.status === "done" && img.resultUrl);
    for (const img of done) {
      handleDownload(img);
    }
  }, [images, handleDownload]);

  const queuedCount = images.filter((i) => i.status === "queued").length;
  const doneCount = images.filter((i) => i.status === "done").length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-2 text-xl font-bold">Remove Watermark</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Removes Gemini watermarks using AI inpainting. Runs 100% locally in your browser.
      </p>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="mb-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-950 p-10 text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-400"
      >
        <svg className="mb-2 h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
        </svg>
        <span className="text-sm">Drop images here or click to select</span>
        <span className="mt-1 text-xs">PNG, JPEG, WebP</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFilesWrapped(e.target.files)}
      />

      {/* Actions */}
      {images.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={processAll}
            disabled={isProcessing || queuedCount === 0}
            className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isProcessing ? "Processing..." : `Remove Watermarks (${queuedCount})`}
          </button>
          {doneCount > 0 && (
            <button
              onClick={handleDownloadAll}
              className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white"
            >
              Download All ({doneCount})
            </button>
          )}
        </div>
      )}

      {/* Model download progress */}
      {modelProgress !== null && modelProgress < 100 && (
        <div className="mb-4 rounded-md bg-neutral-900 border border-neutral-800 p-3">
          <div className="mb-1 text-xs text-neutral-400">
            Loading AI model ({modelProgress}%)...
          </div>
          <div className="h-2 rounded-full bg-neutral-800">
            <div
              className="h-2 rounded-full bg-blue-600 transition-all"
              style={{ width: `${modelProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="rounded-lg border border-neutral-800 bg-neutral-950 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="truncate text-xs text-neutral-400">{img.originalName}</span>
                <StatusBadge status={img.status} detail={img.status === "processing" ? img.error : undefined} />
              </div>

              {/* Before / After */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-center text-xs text-neutral-600">Original</div>
                  <img
                    src={img.originalUrl}
                    alt="Original"
                    className="w-full cursor-pointer rounded border border-neutral-800 object-cover"
                    onClick={() => setPreviewSrc(img.originalUrl)}
                  />
                </div>
                <div>
                  <div className="mb-1 text-center text-xs text-neutral-600">Cleaned</div>
                  {img.status === "done" && img.resultUrl ? (
                    <img
                      src={img.resultUrl}
                      alt="Cleaned"
                      className="w-full cursor-pointer rounded border border-neutral-800 object-cover"
                      onClick={() => setPreviewSrc(img.resultUrl!)}
                    />
                  ) : img.status === "processing" ? (
                    <div className="flex aspect-video items-center justify-center rounded border border-neutral-800 bg-neutral-900">
                      <svg className="h-6 w-6 animate-spin text-neutral-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  ) : img.status === "failed" ? (
                    <div className="flex aspect-video items-center justify-center rounded border border-red-900/50 bg-neutral-900 p-2">
                      <span className="text-xs text-red-400">{img.error}</span>
                    </div>
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded border border-neutral-800 bg-neutral-900">
                      <span className="text-xs text-neutral-600">Waiting...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Download button */}
              {img.status === "done" && img.resultUrl && (
                <button
                  onClick={() => handleDownload(img)}
                  className="mt-2 w-full cursor-pointer rounded bg-neutral-800 py-1.5 text-xs text-neutral-300 hover:text-white"
                >
                  Download
                </button>
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

function StatusBadge({ status, detail }: { status: string; detail?: string }) {
  const styles: Record<string, string> = {
    queued: "bg-neutral-800 text-neutral-400",
    processing: "bg-yellow-900/50 text-yellow-400",
    done: "bg-green-900/50 text-green-400",
    failed: "bg-red-900/50 text-red-400",
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.queued}`}>
      {detail && status === "processing" ? detail : status}
    </span>
  );
}
