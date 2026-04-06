"use client";

import { useState, useCallback, useRef } from "react";
import ImagePreview from "@/components/ImagePreview";

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Segment {
  id: string;
  index: number;
  start: number;
  end: number;
  prompt: string;
  image?: string;
  mimeType?: string;
  status: "idle" | "generating" | "done" | "failed";
  error?: string;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

function createSegment(index: number, start = 0, end = 0): Segment {
  return { id: crypto.randomUUID(), index, start, end, prompt: "", status: "idle" };
}

export default function ManualPage() {
  const [folderPath, setFolderPath] = useState("");
  const [audioFilename, setAudioFilename] = useState("audio.mp4");
  const [words, setWords] = useState<Word[]>([]);
  const [audioDuration, setAudioDuration] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([createSegment(1)]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Transcribe
  const handleTranscribe = useCallback(async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setIsTranscribing(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "mp3" || ext === "mp4") {
        setAudioFilename(`audio.${ext}`);
      }

      const buffer = await file.arrayBuffer();
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: buffer,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }
      const data = await res.json();
      setWords(data.words);
      setAudioDuration(data.duration);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  // Folder
  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setFolderPath(files[0].webkitRelativePath.split("/")[0]);
  }, []);

  // Segment management
  const addSegment = useCallback(() => {
    setSegments((prev) => {
      const lastEnd = prev.length > 0 ? prev[prev.length - 1].end : 0;
      return [...prev, createSegment(prev.length + 1, lastEnd, lastEnd)];
    });
  }, []);

  const updateSegment = useCallback((id: string, updates: Partial<Segment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const deleteSegment = useCallback((id: string) => {
    setSegments((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return filtered.map((s, i) => ({ ...s, index: i + 1 }));
    });
  }, []);

  const reindex = (segs: Segment[]) => segs.map((s, i) => ({ ...s, index: i + 1 }));

  // Drag reorder
  const handleDragStart = useCallback((idx: number) => setDragIdx(idx), []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setSegments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      setDragIdx(idx);
      return reindex(next);
    });
  }, [dragIdx]);

  // Fill gaps
  const fillGaps = useCallback(() => {
    if (audioDuration === 0) return;
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const filled: Segment[] = [];
    let cursor = 0;

    for (const seg of sorted) {
      if (seg.start > cursor + 0.1) {
        filled.push(createSegment(0, cursor, seg.start));
      }
      filled.push(seg);
      cursor = seg.end;
    }

    if (cursor < audioDuration - 0.1) {
      filled.push(createSegment(0, cursor, audioDuration));
    }

    setSegments(reindex(filled));
  }, [segments, audioDuration]);

  // Validation warnings
  const warnings: string[] = [];
  if (audioDuration > 0) {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].end > sorted[i + 1].start + 0.05) {
        warnings.push(`Segments ${sorted[i].index} and ${sorted[i + 1].index} overlap`);
      }
      if (sorted[i + 1].start - sorted[i].end > 0.1) {
        warnings.push(`Gap between segments ${sorted[i].index} and ${sorted[i + 1].index}`);
      }
    }
    if (sorted.length > 0 && sorted[sorted.length - 1].end < audioDuration - 0.1) {
      warnings.push(`Timeline ends at ${formatTime(sorted[sorted.length - 1].end)} but audio is ${formatTime(audioDuration)}`);
    }
  }

  // Generate images
  const handleGenerateImages = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    // Snapshot to avoid stale closure
    const toProcess = segments
      .filter((s) => s.status !== "done" && s.prompt.trim())
      .map((s) => ({ id: s.id, prompt: s.prompt }));

    for (const { id, prompt } of toProcess) {
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "generating" as const, error: undefined } : s))
      );
      try {
        const res = await fetch("/api/gen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, referenceImages: [] }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error);
        }
        const data = await res.json();
        setSegments((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "done" as const, image: data.image, mimeType: data.mimeType } : s))
        );
      } catch (err) {
        setSegments((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "failed" as const, error: err instanceof Error ? err.message : "Failed" } : s))
        );
      }
    }
    setIsGenerating(false);
  }, [segments]);

  // Download
  const downloadImage = useCallback((seg: Segment) => {
    if (!seg.image) return;
    const a = document.createElement("a");
    a.href = `data:${seg.mimeType || "image/jpeg"};base64,${seg.image}`;
    a.download = `${seg.index}.jpeg`;
    a.click();
  }, []);

  const downloadAll = useCallback(() => {
    segments.filter((s) => s.status === "done" && s.image).forEach(downloadImage);
  }, [segments, downloadImage]);

  // FCPXML
  const exportFCPXML = useCallback(() => {
    const fps = 30;
    const totalFrames = Math.ceil(audioDuration * fps);
    const basePath = folderPath ? `file://localhost/${folderPath}/` : "./";

    let imageAssets = "";
    let imageClips = "";

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const durFrames = Math.round((seg.end - seg.start) * fps);
      const offsetFrames = Math.round(seg.start * fps);
      imageAssets += `        <asset id="image_${seg.index}" name="${seg.index}.jpeg" src="${basePath}${seg.index}.jpeg" hasVideo="1" format="r1" />\n`;

      if (i === 0) {
        imageClips += `                        <asset-clip ref="image_${seg.index}" offset="${offsetFrames}/${fps}s" duration="${durFrames}/${fps}s" name="${seg.index}.jpeg">\n`;
        imageClips += `                            <asset-clip ref="audio_1" lane="-1" offset="${offsetFrames}/${fps}s" duration="${totalFrames}/${fps}s" name="${audioFilename}" role="dialogue" />\n`;
        imageClips += `                        </asset-clip>\n`;
      } else {
        imageClips += `                        <asset-clip ref="image_${seg.index}" offset="${offsetFrames}/${fps}s" duration="${durFrames}/${fps}s" name="${seg.index}.jpeg" />\n`;
      }
    }

    const fcpxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">
    <resources>
        <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/${fps}s" width="1920" height="1080" />
        <asset id="audio_1" name="${audioFilename}" src="${basePath}${audioFilename}" hasAudio="1" format="r1" duration="${totalFrames}/${fps}s" />
${imageAssets}    </resources>
    <library>
        <event name="Nano Banana Export">
            <project name="Timeline">
                <sequence format="r1" duration="${totalFrames}/${fps}s" tcStart="0/${fps}s">
                    <spine>
${imageClips}                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;

    const blob = new Blob([fcpxml], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "timeline.fcpxml";
    a.click();
  }, [segments, audioDuration, folderPath]);

  const doneCount = segments.filter((s) => s.status === "done").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-2 text-xl font-bold">Manual Timeline Builder</h1>
      <p className="mb-6 text-sm text-neutral-500">Build your image timeline by hand with the transcript as reference.</p>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-800/50 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      <div className="flex gap-6">
        {/* Left: Transcript */}
        <div className="w-80 flex-shrink-0 space-y-3">
          <h2 className="text-sm font-medium text-neutral-300">Transcript</h2>

          <input
            type="file"
            accept="audio/*,video/mp4"
            onChange={(e) => e.target.files && handleTranscribe(e.target.files)}
            className="block w-full text-xs text-neutral-400 file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-xs file:text-neutral-300 hover:file:bg-neutral-700"
          />

          {isTranscribing && (
            <div className="flex items-center gap-2 text-xs text-yellow-400">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Transcribing...
            </div>
          )}

          {words.length > 0 && (
            <>
              <div className="text-xs text-neutral-500">Duration: {formatTime(audioDuration)}</div>
              <div className="max-h-[70vh] overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 p-3 space-y-1">
                {(() => {
                  // Group into sentences
                  const groups: { start: number; text: string }[] = [];
                  let current = { start: 0, text: "" };
                  for (let i = 0; i < words.length; i++) {
                    const w = words[i];
                    if (i === 0 || w.start - words[i - 1].end > 0.5) {
                      if (current.text) groups.push(current);
                      current = { start: w.start, text: w.word };
                    } else {
                      current.text += " " + w.word;
                    }
                  }
                  if (current.text) groups.push(current);

                  return groups.map((g, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="w-12 flex-shrink-0 text-right text-[10px] text-neutral-600 pt-0.5">
                        {formatTime(g.start)}
                      </span>
                      <span className="text-xs text-neutral-300 leading-relaxed">{g.text}</span>
                    </div>
                  ));
                })()}
              </div>
            </>
          )}
        </div>

        {/* Right: Timeline builder */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-neutral-300">Timeline</h2>
            {/* Folder picker */}
            <label className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300">
              {folderPath ? (
                <span className="font-mono text-neutral-400">{folderPath}/</span>
              ) : (
                "Select folder"
              )}
              <input
                type="file"
                /* @ts-expect-error webkitdirectory is non-standard */
                webkitdirectory=""
                onChange={handleFolderSelect}
                className="hidden"
              />
            </label>
          </div>

          {/* Visual timeline bar */}
          {audioDuration > 0 && segments.length > 0 && (
            <div className="rounded bg-neutral-800 h-6 relative overflow-hidden">
              {segments.map((s) => (
                <div
                  key={s.id}
                  className={`absolute top-0 bottom-0 border-r border-neutral-700 ${
                    s.status === "done" ? "bg-green-600/50" : s.status === "failed" ? "bg-red-600/50" : "bg-blue-600/40"
                  }`}
                  style={{
                    left: `${(s.start / audioDuration) * 100}%`,
                    width: `${(Math.max(s.end - s.start, 0) / audioDuration) * 100}%`,
                  }}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/70">{s.index}</span>
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-md bg-yellow-900/20 border border-yellow-800/40 px-3 py-2 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className="text-xs text-yellow-400">{w}</div>
              ))}
            </div>
          )}

          {/* Segments */}
          <div className="space-y-2">
            {segments.map((seg, idx) => (
              <div
                key={seg.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={() => setDragIdx(null)}
                className="rounded-md border border-neutral-800 bg-neutral-950 p-3 cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-neutral-600 cursor-grab">⠿</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-400">
                    {seg.index}.jpeg
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={seg.start}
                    onChange={(e) => updateSegment(seg.id, { start: parseFloat(e.target.value) || 0 })}
                    className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white"
                    placeholder="Start"
                  />
                  <span className="text-xs text-neutral-600">→</span>
                  <input
                    type="number"
                    step="0.1"
                    value={seg.end}
                    onChange={(e) => updateSegment(seg.id, { end: parseFloat(e.target.value) || 0 })}
                    className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white"
                    placeholder="End"
                  />
                  <span className="text-[10px] text-neutral-600">({formatTime(seg.start)} → {formatTime(seg.end)})</span>

                  {seg.status === "done" && <span className="text-[10px] text-green-400">Done</span>}
                  {seg.status === "generating" && (
                    <svg className="h-3 w-3 animate-spin text-yellow-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {seg.status === "failed" && <span className="text-[10px] text-red-400">Failed</span>}

                  <div className="ml-auto">
                    <button
                      onClick={() => deleteSegment(seg.id)}
                      className="cursor-pointer text-neutral-600 hover:text-red-400 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <textarea
                  value={seg.prompt}
                  onChange={(e) => updateSegment(seg.id, { prompt: e.target.value })}
                  placeholder="Image prompt..."
                  className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white placeholder-neutral-600"
                  rows={2}
                />

                {seg.error && <p className="mt-1 text-[10px] text-red-400">{seg.error}</p>}

                {seg.status === "done" && seg.image && (
                  <div className="mt-2 flex items-start gap-2">
                    <img
                      src={`data:${seg.mimeType};base64,${seg.image}`}
                      alt={`${seg.index}`}
                      className="h-20 cursor-pointer rounded border border-neutral-700"
                      onClick={() => setPreviewSrc(`data:${seg.mimeType};base64,${seg.image}`)}
                    />
                    <button
                      onClick={() => downloadImage(seg)}
                      className="cursor-pointer rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-white"
                    >
                      Download
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Segment actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={addSegment}
              className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs text-neutral-300 hover:text-white"
            >
              + Add Segment
            </button>
            {audioDuration > 0 && (
              <button
                onClick={fillGaps}
                className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs text-neutral-300 hover:text-white"
              >
                Fill Gaps
              </button>
            )}
          </div>

          {/* Bottom actions */}
          <div className="flex flex-wrap gap-3 border-t border-neutral-800 pt-4">
            <button
              onClick={handleGenerateImages}
              disabled={isGenerating || segments.every((s) => !s.prompt.trim() || s.status === "done")}
              className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {isGenerating ? "Generating..." : "Generate Images"}
            </button>
            <button
              onClick={exportFCPXML}
              disabled={!folderPath || segments.length === 0}
              className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white disabled:opacity-40"
            >
              Export FCPXML
            </button>
            {doneCount > 0 && (
              <button
                onClick={downloadAll}
                className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white"
              >
                Download All ({doneCount})
              </button>
            )}
          </div>
        </div>
      </div>

      {previewSrc && <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
}
