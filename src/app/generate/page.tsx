"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ReferenceImage } from "@/types";
import ImagePreview from "@/components/ImagePreview";

const MAX_IMAGES = 14;
const PRESETS_STORAGE_KEY = "nano-banana-presets";
const MAX_REF_IMAGE_DIMENSION = 1024; // Resize reference images to max 1024px

// Resize image to fit within maxDim, return base64 jpeg
function resizeImageBase64(base64: string, mimeType: string, maxDim: number): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        resolve({ base64, mimeType });
        return;
      }
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

type AspectRatio = "16:9" | "9:16";

interface Row {
  id: string;
  prompt: string;
  referenceImages: ReferenceImage[];
  status: "idle" | "generating" | "done" | "failed";
  resultImage?: string;
  resultMimeType?: string;
  error?: string;
  aspectRatio: AspectRatio;
}

interface Preset {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
}

function createRow(prompt = ""): Row {
  return { id: crypto.randomUUID(), prompt, referenceImages: [], status: "idle", aspectRatio: "16:9" };
}

function loadPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: Preset[]) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

async function callGenerate(
  prompt: string,
  referenceImages: ReferenceImage[],
  aspectRatio: AspectRatio
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
      aspectRatio,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(error.error || `Generation failed (${res.status})`);
  }
  return res.json();
}

export default function GeneratePage() {
  const [rows, setRows] = useState<Row[]>([createRow()]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresets, setActivePresets] = useState<Set<string>>(new Set());
  const [showJsonInput, setShowJsonInput] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [showNewPreset, setShowNewPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [pendingPresetFile, setPendingPresetFile] = useState<{ base64: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const presetFileRef = useRef<HTMLInputElement>(null);
  const watermarkFileRef = useRef<HTMLInputElement>(null);
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const updateRow = useCallback((id: string, updates: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  }, []);

  const deleteRow = useCallback((id: string) => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      return filtered.length === 0 ? [createRow()] : filtered;
    });
  }, []);

  const addRefImages = useCallback(
    async (rowId: string, files: FileList) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      const remaining = MAX_IMAGES - row.referenceImages.length;
      const toProcess = Array.from(files).slice(0, remaining);

      const newImages: ReferenceImage[] = await Promise.all(
        toProcess.map(async (file) => {
          const raw = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          const rawBase64 = raw.split(",")[1];
          // Resize to keep request size under Vercel's 4.5MB limit
          const resized = await resizeImageBase64(rawBase64, file.type, MAX_REF_IMAGE_DIMENSION);
          return {
            id: crypto.randomUUID(),
            base64: resized.base64,
            mimeType: resized.mimeType as ReferenceImage["mimeType"],
            name: file.name,
            size: resized.base64.length,
          };
        })
      );

      updateRow(rowId, { referenceImages: [...row.referenceImages, ...newImages] });
    },
    [rows, updateRow]
  );

  const removeRefImage = useCallback(
    (rowId: string, imgId: string) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      updateRow(rowId, { referenceImages: row.referenceImages.filter((img) => img.id !== imgId) });
    },
    [rows, updateRow]
  );

  // Presets
  const togglePreset = useCallback(
    (preset: Preset) => {
      const refId = `preset-${preset.id}`;
      const isActive = activePresets.has(preset.id);

      if (isActive) {
        setRows((prev) =>
          prev.map((r) => ({
            ...r,
            referenceImages: r.referenceImages.filter((img) => img.id !== refId),
          }))
        );
        setActivePresets((prev) => { const n = new Set(prev); n.delete(preset.id); return n; });
      } else {
        const refImg: ReferenceImage = {
          id: refId,
          base64: preset.base64,
          mimeType: preset.mimeType as ReferenceImage["mimeType"],
          name: preset.name,
          size: preset.base64.length,
        };
        setRows((prev) =>
          prev.map((r) => ({
            ...r,
            referenceImages: r.referenceImages.some((img) => img.id === refId)
              ? r.referenceImages
              : [...r.referenceImages, refImg],
          }))
        );
        setActivePresets((prev) => new Set(prev).add(preset.id));
      }
    },
    [activePresets]
  );

  const deletePreset = useCallback(
    (presetId: string) => {
      const updated = presets.filter((p) => p.id !== presetId);
      setPresets(updated);
      savePresetsToStorage(updated);
      const refId = `preset-${presetId}`;
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          referenceImages: r.referenceImages.filter((img) => img.id !== refId),
        }))
      );
      setActivePresets((prev) => { const n = new Set(prev); n.delete(presetId); return n; });
    },
    [presets]
  );

  const handlePresetFile = useCallback((files: FileList) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPendingPresetFile({ base64: dataUrl.split(",")[1], mimeType: file.type });
    };
    reader.readAsDataURL(file);
  }, []);

  const saveNewPreset = useCallback(async () => {
    if (!pendingPresetFile || !newPresetName.trim()) return;
    // Resize for storage (512px max to keep localStorage small)
    const resized = await resizeImageBase64(pendingPresetFile.base64, pendingPresetFile.mimeType, 512);
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: newPresetName.trim(),
      base64: resized.base64,
      mimeType: resized.mimeType,
    };
    const updated = [...presets, preset];
    setPresets(updated);
    try {
      savePresetsToStorage(updated);
    } catch {
      // If still too large, warn user
      setError("Preset image too large to save. Try a smaller image.");
      setPresets(presets);
      return;
    }
    setShowNewPreset(false);
    setNewPresetName("");
    setPendingPresetFile(null);
  }, [pendingPresetFile, newPresetName, presets]);

  // JSON import — just creates rows
  const handleJsonImport = useCallback(() => {
    let prompts: string[];
    try {
      prompts = JSON.parse(jsonInput);
      if (!Array.isArray(prompts) || !prompts.every((p) => typeof p === "string")) throw new Error("");
    } catch {
      setError('Invalid JSON. Expected: ["prompt1", "prompt2", ...]');
      return;
    }
    if (prompts.length === 0) return;

    const newRows = prompts.map((p) => {
      const row = createRow(p);
      // Apply active presets to new rows
      for (const presetId of activePresets) {
        const preset = presets.find((pr) => pr.id === presetId);
        if (preset) {
          row.referenceImages.push({
            id: `preset-${preset.id}`,
            base64: preset.base64,
            mimeType: preset.mimeType as ReferenceImage["mimeType"],
            name: preset.name,
            size: preset.base64.length,
          });
        }
      }
      return row;
    });

    setRows((prev) => [...prev, ...newRows]);
    setShowJsonInput(false);
    setJsonInput("");
    setError(null);
  }, [jsonInput, activePresets, presets]);

  // Remove watermarks — upload images, create rows with watermark removal prompt
  const handleWatermarkFiles = useCallback(
    async (files: FileList) => {
      const WATERMARK_PROMPT = "remove the diamond shaped white shape in the bottom right of the attached image";
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      const newRows: Row[] = await Promise.all(
        imageFiles.map(async (file) => {
          const raw = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          const rawBase64 = raw.split(",")[1];
          const resized = await resizeImageBase64(rawBase64, file.type, MAX_REF_IMAGE_DIMENSION);

          const row = createRow(WATERMARK_PROMPT);
          row.referenceImages = [
            {
              id: crypto.randomUUID(),
              base64: resized.base64,
              mimeType: resized.mimeType as ReferenceImage["mimeType"],
              name: file.name,
              size: resized.base64.length,
            },
          ];
          return row;
        })
      );

      setRows((prev) => [...prev, ...newRows]);
    },
    []
  );

  // Generate all rows that have a prompt
  const handleGenerateAll = useCallback(async () => {
    const toGenerate = rows
      .filter((r) => r.prompt.trim() && (r.status === "idle" || r.status === "failed"))
      .map((r) => ({ id: r.id, prompt: r.prompt, referenceImages: r.referenceImages, aspectRatio: r.aspectRatio }));
    if (toGenerate.length === 0) return;
    setIsGenerating(true);

    for (const { id, prompt, referenceImages, aspectRatio } of toGenerate) {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "generating" as const, error: undefined } : r))
      );

      try {
        const result = await callGenerate(prompt, referenceImages, aspectRatio);
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "done" as const, resultImage: result.image, resultMimeType: result.mimeType } : r))
        );
      } catch (err) {
        setRows((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "failed" as const, error: err instanceof Error ? err.message : "Failed" } : r))
        );
      }
    }

    setIsGenerating(false);
  }, [rows]);

  const handleDownload = useCallback((row: Row) => {
    if (!row.resultImage || !row.resultMimeType) return;
    const ext = row.resultMimeType.split("/")[1] || "png";
    const a = document.createElement("a");
    a.href = `data:${row.resultMimeType};base64,${row.resultImage}`;
    a.download = `nano-banana-${row.id.slice(0, 8)}.${ext}`;
    a.click();
  }, []);

  const handleRetry = useCallback(
    (id: string) => {
      updateRow(id, { status: "idle", resultImage: undefined, resultMimeType: undefined, error: undefined });
    },
    [updateRow]
  );

  const validCount = rows.filter((r) => r.prompt.trim() && (r.status === "idle" || r.status === "failed")).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Image Generation</h1>
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
          Nano Banana 2 · 16:9 · 2K
        </span>
      </div>

      {/* Presets + tools bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Presets:</span>
        {presets.map((preset) => (
          <div key={preset.id} className="group relative">
            <button
              onClick={() => togglePreset(preset)}
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
        <button
          onClick={() => setShowNewPreset(true)}
          className="cursor-pointer rounded-md border border-dashed border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300"
        >
          + Preset
        </button>
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
        <button
          onClick={() => watermarkFileRef.current?.click()}
          className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300"
        >
          Remove Watermarks
        </button>
        <input
          ref={watermarkFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleWatermarkFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* New preset form */}
      {showNewPreset && (
        <div className="mb-4 rounded-lg border border-neutral-700 bg-neutral-900 p-3 space-y-2">
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
              <img src={`data:${pendingPresetFile.mimeType};base64,${pendingPresetFile.base64}`} alt="" className="h-12 w-12 rounded border border-neutral-700 object-cover" />
              <span className="text-xs text-green-400">Image loaded</span>
            </div>
          ) : (
            <button onClick={() => presetFileRef.current?.click()} className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:text-white">
              Upload Image
            </button>
          )}
          <input ref={presetFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files && handlePresetFile(e.target.files)} />
          <div className="flex gap-2">
            <button onClick={saveNewPreset} disabled={!newPresetName.trim() || !pendingPresetFile} className="cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40">Save</button>
            <button onClick={() => { setShowNewPreset(false); setNewPresetName(""); setPendingPresetFile(null); }} className="cursor-pointer rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {/* JSON input */}
      {showJsonInput && (
        <div className="mb-4 space-y-2">
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
            className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Import Prompts
          </button>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md bg-red-900/30 border border-red-800/50 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      {/* Rows */}
      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex gap-3">
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">Row {index + 1}</span>
                  {row.status === "generating" && (
                    <span className="flex items-center gap-1 text-xs text-yellow-400">
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating...
                    </span>
                  )}
                  {row.status === "done" && <span className="text-xs text-green-400">Done</span>}
                  {row.status === "failed" && <span className="text-xs text-red-400">Failed</span>}
                </div>

                <textarea
                  value={row.prompt}
                  onChange={(e) => updateRow(row.id, { prompt: e.target.value })}
                  disabled={row.status === "generating"}
                  placeholder="Enter your image generation prompt..."
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
                  rows={2}
                />

                {/* Reference images for this row */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      const input = fileInputRefs.current.get(row.id);
                      input?.click();
                    }}
                    disabled={row.status === "generating" || row.referenceImages.length >= MAX_IMAGES}
                    className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-400 hover:text-white disabled:opacity-40"
                  >
                    + Ref
                  </button>
                  <input
                    ref={(el) => { if (el) fileInputRefs.current.set(row.id, el); }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && addRefImages(row.id, e.target.files)}
                  />
                  {row.referenceImages.length > 0 && (
                    <span className="text-xs text-neutral-600">{row.referenceImages.length}/{MAX_IMAGES}</span>
                  )}
                  <label className="flex items-center gap-1 text-xs text-neutral-500">
                    Aspect
                    <select
                      value={row.aspectRatio}
                      onChange={(e) => updateRow(row.id, { aspectRatio: e.target.value as AspectRatio })}
                      disabled={row.status === "generating"}
                      className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:text-white disabled:opacity-40"
                    >
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                    </select>
                  </label>
                </div>

                {row.referenceImages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.referenceImages.map((img) => (
                      <div key={img.id} className="group relative">
                        <img
                          src={`data:${img.mimeType};base64,${img.base64}`}
                          alt={img.name}
                          className="h-12 w-12 cursor-pointer rounded border border-neutral-700 object-cover"
                          onClick={() => setPreviewSrc(`data:${img.mimeType};base64,${img.base64}`)}
                        />
                        {row.status !== "generating" && (
                          <button
                            onClick={() => removeRefImage(row.id, img.id)}
                            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {row.error && <p className="text-xs text-red-400">{row.error}</p>}

                {/* Row actions */}
                {row.status === "done" && (
                  <div className="flex gap-2">
                    <button onClick={() => handleRetry(row.id)} className="cursor-pointer rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:text-white">Retry</button>
                    <button onClick={() => handleDownload(row)} className="cursor-pointer rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500">Download</button>
                  </div>
                )}
                {row.status === "failed" && (
                  <button onClick={() => handleRetry(row.id)} className="cursor-pointer rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:text-white">Retry</button>
                )}
              </div>

              {/* Delete row */}
              <button
                onClick={() => deleteRow(row.id)}
                disabled={row.status === "generating"}
                className="self-start cursor-pointer text-neutral-600 hover:text-red-400 disabled:opacity-30"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* Full-width result image below */}
            {row.status === "done" && row.resultImage && (
              <div className="mt-4 border-t border-neutral-800 pt-4">
                <img
                  src={`data:${row.resultMimeType};base64,${row.resultImage}`}
                  alt="Generated"
                  className="w-full cursor-pointer rounded-md border border-neutral-700"
                  onClick={() => setPreviewSrc(`data:${row.resultMimeType};base64,${row.resultImage}`)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={() => {
            const row = createRow();
            // Apply active presets
            for (const presetId of activePresets) {
              const preset = presets.find((p) => p.id === presetId);
              if (preset) {
                row.referenceImages.push({
                  id: `preset-${preset.id}`,
                  base64: preset.base64,
                  mimeType: preset.mimeType as ReferenceImage["mimeType"],
                  name: preset.name,
                  size: preset.base64.length,
                });
              }
            }
            setRows((prev) => [...prev, row]);
          }}
          className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white"
        >
          + Add Row
        </button>
        <button
          onClick={handleGenerateAll}
          disabled={validCount === 0 || isGenerating}
          className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating...
            </span>
          ) : (
            `Generate All (${validCount})`
          )}
        </button>
      </div>

      {previewSrc && <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
}
