"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ReferenceImage } from "@/types";
import ImagePreview from "@/components/ImagePreview";

const MAX_IMAGES = 14;
const PRESETS_STORAGE_KEY = "nano-banana-presets";

interface GenerationResult {
  id: string;
  prompt: string;
  image: string;
  mimeType: string;
  status: "idle" | "generating" | "done" | "failed";
  error?: string;
}

interface Preset {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
}

function loadPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
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
  const [activePresets, setActivePresets] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showJsonInput, setShowJsonInput] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [showNewPreset, setShowNewPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetFileRef = useRef<HTMLInputElement>(null);
  const [pendingPresetFile, setPendingPresetFile] = useState<{ base64: string; mimeType: string } | null>(null);

  // Load presets from localStorage
  useEffect(() => {
    setPresets(loadPresets());
  }, []);

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

  const removeImage = useCallback(
    (imgId: string) => {
      setReferenceImages((prev) => prev.filter((img) => img.id !== imgId));
      // Deactivate any preset that matches this image
      setActivePresets((prev) => {
        const next = new Set(prev);
        next.delete(imgId);
        return next;
      });
    },
    []
  );

  const togglePreset = useCallback(
    (preset: Preset) => {
      const presetRefId = `preset-${preset.id}`;
      if (activePresets.has(preset.id)) {
        setReferenceImages((prev) => prev.filter((img) => img.id !== presetRefId));
        setActivePresets((prev) => {
          const next = new Set(prev);
          next.delete(preset.id);
          return next;
        });
      } else {
        const refImg: ReferenceImage = {
          id: presetRefId,
          base64: preset.base64,
          mimeType: preset.mimeType as ReferenceImage["mimeType"],
          name: preset.name,
          size: preset.base64.length,
        };
        setReferenceImages((prev) => {
          if (prev.some((r) => r.id === presetRefId)) return prev;
          return [...prev, refImg];
        });
        setActivePresets((prev) => new Set(prev).add(preset.id));
      }
    },
    [activePresets]
  );

  const handlePresetFile = useCallback((files: FileList) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setPendingPresetFile({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  }, []);

  const saveNewPreset = useCallback(() => {
    if (!pendingPresetFile || !newPresetName.trim()) return;
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: newPresetName.trim(),
      base64: pendingPresetFile.base64,
      mimeType: pendingPresetFile.mimeType,
    };
    const updated = [...presets, preset];
    setPresets(updated);
    savePresets(updated);
    setShowNewPreset(false);
    setNewPresetName("");
    setPendingPresetFile(null);
  }, [pendingPresetFile, newPresetName, presets]);

  const deletePreset = useCallback(
    (presetId: string) => {
      const updated = presets.filter((p) => p.id !== presetId);
      setPresets(updated);
      savePresets(updated);
      // Remove from reference images if active
      const presetRefId = `preset-${presetId}`;
      setReferenceImages((prev) => prev.filter((img) => img.id !== presetRefId));
      setActivePresets((prev) => {
        const next = new Set(prev);
        next.delete(presetId);
        return next;
      });
    },
    [presets]
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateImage(prompt, referenceImages);
      setResults((prev) => [
        { id: crypto.randomUUID(), prompt, image: result.image, mimeType: result.mimeType, status: "done" },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, referenceImages, isGenerating]);

  // Parse JSON and populate prompt rows
  const handleJsonImport = useCallback(() => {
    let prompts: string[];
    try {
      prompts = JSON.parse(jsonInput);
      if (!Array.isArray(prompts) || !prompts.every((p) => typeof p === "string")) {
        throw new Error("Invalid");
      }
    } catch {
      setError('Invalid JSON. Expected format: ["prompt1", "prompt2", ...]');
      return;
    }

    if (prompts.length === 0) return;

    // Add as results with "idle" status — user can review then generate
    const newResults: GenerationResult[] = prompts.map((p) => ({
      id: crypto.randomUUID(),
      prompt: p,
      image: "",
      mimeType: "",
      status: "idle" as const,
    }));
    setResults((prev) => [...newResults, ...prev]);
    setShowJsonInput(false);
    setJsonInput("");
    setError(null);
  }, [jsonInput]);

  const handleGenerateRow = useCallback(
    async (id: string) => {
      const row = results.find((r) => r.id === id);
      if (!row || row.status !== "idle") return;

      setResults((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "generating" as const } : r))
      );

      try {
        const result = await generateImage(row.prompt, referenceImages);
        setResults((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, image: result.image, mimeType: result.mimeType, status: "done" as const }
              : r
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        setResults((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "failed" as const, error: message } : r))
        );
      }
    },
    [results, referenceImages]
  );

  const handleGenerateAllIdle = useCallback(async () => {
    const idleRows = results.filter((r) => r.status === "idle");
    if (idleRows.length === 0) return;
    setIsGenerating(true);

    for (const row of idleRows) {
      setResults((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: "generating" as const } : r))
      );

      try {
        const result = await generateImage(row.prompt, referenceImages);
        setResults((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, image: result.image, mimeType: result.mimeType, status: "done" as const }
              : r
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        setResults((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: "failed" as const, error: message } : r
          )
        );
      }
    }

    setIsGenerating(false);
  }, [results, referenceImages]);

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

        {/* Reference images + presets */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating || referenceImages.length >= MAX_IMAGES}
            className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Reference Images
          </button>

          {/* Saved presets */}
          {presets.map((preset) => (
            <div key={preset.id} className="group relative">
              <button
                onClick={() => togglePreset(preset)}
                disabled={isGenerating}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activePresets.has(preset.id)
                    ? "bg-blue-600 text-white hover:bg-blue-500"
                    : "border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white"
                }`}
              >
                {activePresets.has(preset.id) ? `${preset.name} ✓` : preset.name}
              </button>
              <button
                onClick={() => deletePreset(preset.id)}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add preset button */}
          <button
            onClick={() => setShowNewPreset(true)}
            className="cursor-pointer rounded-md border border-dashed border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300"
          >
            + Preset
          </button>

          {/* JSON paste button */}
          <button
            onClick={() => setShowJsonInput(!showJsonInput)}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs transition-colors ${
              showJsonInput
                ? "border-blue-600 bg-blue-600/20 text-blue-400"
                : "border-neutral-700 bg-neutral-900 text-neutral-500 hover:text-neutral-300"
            }`}
          >
            JSON Batch
          </button>

          <span className="text-xs text-neutral-500">
            {referenceImages.length}/{MAX_IMAGES}
          </span>
        </div>

        {/* New preset form */}
        {showNewPreset && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3 space-y-2">
            <div className="text-xs text-neutral-400">Create new preset</div>
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Preset name..."
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500"
            />
            {pendingPresetFile ? (
              <div className="flex items-center gap-2">
                <img
                  src={`data:${pendingPresetFile.mimeType};base64,${pendingPresetFile.base64}`}
                  alt="Preview"
                  className="h-12 w-12 rounded border border-neutral-700 object-cover"
                />
                <span className="text-xs text-green-400">Image loaded</span>
              </div>
            ) : (
              <button
                onClick={() => presetFileRef.current?.click()}
                className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:text-white"
              >
                Upload Image
              </button>
            )}
            <input
              ref={presetFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files && handlePresetFile(e.target.files)}
            />
            <div className="flex gap-2">
              <button
                onClick={saveNewPreset}
                disabled={!newPresetName.trim() || !pendingPresetFile}
                className="cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Save Preset
              </button>
              <button
                onClick={() => {
                  setShowNewPreset(false);
                  setNewPresetName("");
                  setPendingPresetFile(null);
                }}
                className="cursor-pointer rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* JSON input */}
        {showJsonInput && (
          <div className="space-y-2">
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='["prompt 1", "prompt 2", "prompt 3"]'
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder-neutral-500 font-mono"
              rows={4}
            />
            <button
              onClick={handleJsonImport}
              disabled={!jsonInput.trim()}
              className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import Prompts
            </button>
          </div>
        )}

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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-400">Results</h2>
            {results.some((r) => r.status === "idle") && (
              <button
                onClick={handleGenerateAllIdle}
                disabled={isGenerating}
                className="cursor-pointer rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isGenerating ? "Generating..." : `Generate All (${results.filter((r) => r.status === "idle").length})`}
              </button>
            )}
          </div>
          {results.map((result) => (
            <div
              key={result.id}
              className="rounded-lg border border-neutral-800 bg-neutral-950 p-4"
            >
              <p className="mb-3 text-xs text-neutral-500">{result.prompt}</p>

              {result.status === "idle" && (
                <button
                  onClick={() => handleGenerateRow(result.id)}
                  disabled={isGenerating}
                  className="w-full cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 py-2 text-xs text-neutral-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Generate
                </button>
              )}

              {result.status === "generating" && (
                <div className="flex aspect-video items-center justify-center rounded-md border border-neutral-800 bg-neutral-900">
                  <div className="flex items-center gap-2 text-neutral-500">
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm">Generating...</span>
                  </div>
                </div>
              )}

              {result.status === "done" && (
                <>
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
                </>
              )}

              {result.status === "failed" && (
                <div className="rounded-md bg-red-900/20 border border-red-800/40 px-3 py-3 text-xs text-red-400">
                  {result.error || "Generation failed"}
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
