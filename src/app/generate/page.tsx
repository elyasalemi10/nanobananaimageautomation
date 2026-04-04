"use client";

import { useState, useCallback, useRef } from "react";
import { ReferenceImage } from "@/types";
import ImagePreview from "@/components/ImagePreview";

const MAX_IMAGES = 14;

interface GenerationResult {
  id: string;
  prompt: string;
  image: string;
  mimeType: string;
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

async function generateImage(
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

export default function GeneratePage() {
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [henryActive, setHenryActive] = useState(false);
  const [henryImage, setHenryImage] = useState<ReferenceImage | null>(null);
  const [henryLoading, setHenryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList) => {
      const remaining = MAX_IMAGES - referenceImages.length;
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

      setReferenceImages((prev) => [...prev, ...newImages]);
    },
    [referenceImages.length]
  );

  const removeImage = useCallback((imgId: string) => {
    setReferenceImages((prev) => prev.filter((img) => img.id !== imgId));
    if (imgId === "henry-preset") setHenryActive(false);
  }, []);

  const toggleHenryPreset = useCallback(async () => {
    if (henryActive) {
      setReferenceImages((prev) => prev.filter((img) => img.id !== "henry-preset"));
      setHenryActive(false);
    } else {
      let img = henryImage;
      if (!img) {
        setHenryLoading(true);
        img = await loadHenryPreset();
        setHenryImage(img);
        setHenryLoading(false);
      }
      setReferenceImages((prev) => {
        if (prev.some((r) => r.id === "henry-preset")) return prev;
        return [...prev, img];
      });
      setHenryActive(true);
    }
  }, [henryActive, henryImage]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateImage(prompt, referenceImages);
      setResults((prev) => [
        { id: crypto.randomUUID(), prompt, image: result.image, mimeType: result.mimeType },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, referenceImages, isGenerating]);

  const handleDownload = useCallback((result: GenerationResult) => {
    const ext = result.mimeType.split("/")[1] || "png";
    const link = document.createElement("a");
    link.href = `data:${result.mimeType};base64,${result.image}`;
    link.download = `nano-banana-${result.id.slice(0, 8)}.${ext}`;
    link.click();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-bold">Image Generation</h1>
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
          Nano Banana 2 · 16:9 · 2K
        </span>
      </div>

      {/* Prompt */}
      <div className="space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your image generation prompt..."
          disabled={isGenerating}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
        />

        {/* Reference images */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating || referenceImages.length >= MAX_IMAGES}
            className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Reference Images
          </button>
          <button
            onClick={toggleHenryPreset}
            disabled={henryLoading || isGenerating}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              henryLoading
                ? "border border-neutral-700 bg-neutral-900 text-neutral-500 cursor-wait"
                : henryActive
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white"
            }`}
          >
            {henryLoading ? "Loading..." : henryActive ? "Henry ✓" : "Henry Preset"}
          </button>
          <span className="text-xs text-neutral-500">
            {referenceImages.length}/{MAX_IMAGES}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        {referenceImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {referenceImages.map((img) => (
              <div key={img.id} className="group relative">
                <img
                  src={`data:${img.mimeType};base64,${img.base64}`}
                  alt={img.name}
                  className="h-16 w-16 cursor-pointer rounded-md border border-neutral-700 object-cover"
                  onClick={() => setPreviewSrc(`data:${img.mimeType};base64,${img.base64}`)}
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating}
          className="w-full cursor-pointer rounded-lg bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating...
            </span>
          ) : (
            "Generate (⌘↵)"
          )}
        </button>

        {error && (
          <p className="rounded-md bg-red-900/30 border border-red-800/50 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-sm font-medium text-neutral-400">Results</h2>
          {results.map((result) => (
            <div
              key={result.id}
              className="rounded-lg border border-neutral-800 bg-neutral-950 p-4"
            >
              <p className="mb-3 text-xs text-neutral-500">{result.prompt}</p>
              <img
                src={`data:${result.mimeType};base64,${result.image}`}
                alt="Generated"
                className="w-full cursor-pointer rounded-md border border-neutral-700"
                onClick={() =>
                  setPreviewSrc(`data:${result.mimeType};base64,${result.image}`)
                }
              />
              <button
                onClick={() => handleDownload(result)}
                className="mt-3 w-full cursor-pointer rounded-md bg-neutral-800 py-2 text-xs text-neutral-300 hover:text-white"
              >
                Download
              </button>
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
