"use client";

import { useState, useCallback, useRef } from "react";
import ImagePreview from "@/components/ImagePreview";

interface Word {
  word: string;
  start: number;
  end: number;
}

interface TimelineEntry {
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

function secondsToFrames(s: number, fps = 30): string {
  return `${Math.round(s * fps)}/${fps}s`;
}

export default function PipelinePage() {
  const [step, setStep] = useState(1);
  const [folderPath, setFolderPath] = useState("");
  const [audioFilename, setAudioFilename] = useState("audio.mp4");
  const [words, setWords] = useState<Word[]>([]);
  const [audioDuration, setAudioDuration] = useState(0);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [stylePrompt, setStylePrompt] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingTimeline, setIsGeneratingTimeline] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Step 1: Folder selection
  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const firstPath = files[0].webkitRelativePath;
    const folder = firstPath.split("/")[0];
    setFolderPath(folder);
  }, []);

  // Step 2: Transcribe
  const handleTranscribe = useCallback(async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setIsTranscribing(true);
    setError(null);

    try {
      // Detect audio filename for FCPXML export
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
        const err = await res.json().catch(() => ({ error: "Transcription failed" }));
        throw new Error(err.error || `Transcription failed (${res.status})`);
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

  // Step 3: Generate timeline with Kimi
  const handleGenerateTimeline = useCallback(async () => {
    setIsGeneratingTimeline(true);
    setError(null);

    const transcript = words
      .map((w) => `[${formatTime(w.start)}] ${w.word}`)
      .join(" ");

    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          audioDuration,
          stylePrompt,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Timeline generation failed" }));
        throw new Error(err.error || err.raw || `Failed (${res.status})`);
      }

      const data = await res.json();
      const entries: TimelineEntry[] = data.timeline.map(
        (t: { start: number; end: number; prompt: string }, i: number) => ({
          index: i + 1,
          start: t.start,
          end: t.end,
          prompt: t.prompt,
          status: "idle" as const,
        })
      );
      setTimeline(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Timeline generation failed");
    } finally {
      setIsGeneratingTimeline(false);
    }
  }, [words, audioDuration, stylePrompt]);

  // Step 4: Generate images
  const handleGenerateImages = useCallback(async () => {
    setIsGeneratingImages(true);
    setError(null);

    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (entry.status === "done") continue;

      setTimeline((prev) =>
        prev.map((t) => (t.index === entry.index ? { ...t, status: "generating" as const } : t))
      );

      try {
        const res = await fetch("/api/gen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: entry.prompt, referenceImages: [] }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Generation failed" }));
          throw new Error(err.error || `Failed (${res.status})`);
        }

        const data = await res.json();
        setTimeline((prev) =>
          prev.map((t) =>
            t.index === entry.index
              ? { ...t, status: "done" as const, image: data.image, mimeType: data.mimeType }
              : t
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed";
        setTimeline((prev) =>
          prev.map((t) =>
            t.index === entry.index ? { ...t, status: "failed" as const, error: message } : t
          )
        );
      }
    }

    setIsGeneratingImages(false);
  }, [timeline]);

  const retryImage = useCallback(
    async (index: number) => {
      const entry = timeline.find((t) => t.index === index);
      if (!entry) return;

      setTimeline((prev) =>
        prev.map((t) => (t.index === index ? { ...t, status: "generating" as const, error: undefined } : t))
      );

      try {
        const res = await fetch("/api/gen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: entry.prompt, referenceImages: [] }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed" }));
          throw new Error(err.error);
        }

        const data = await res.json();
        setTimeline((prev) =>
          prev.map((t) =>
            t.index === index
              ? { ...t, status: "done" as const, image: data.image, mimeType: data.mimeType }
              : t
          )
        );
      } catch (err) {
        setTimeline((prev) =>
          prev.map((t) =>
            t.index === index
              ? { ...t, status: "failed" as const, error: err instanceof Error ? err.message : "Failed" }
              : t
          )
        );
      }
    },
    [timeline]
  );

  // Download helpers
  const downloadImage = useCallback((entry: TimelineEntry) => {
    if (!entry.image) return;
    const a = document.createElement("a");
    a.href = `data:${entry.mimeType || "image/jpeg"};base64,${entry.image}`;
    a.download = `${entry.index}.jpeg`;
    a.click();
  }, []);

  const downloadAllImages = useCallback(() => {
    for (const entry of timeline) {
      if (entry.status === "done" && entry.image) {
        downloadImage(entry);
      }
    }
  }, [timeline, downloadImage]);

  // FCPXML generation
  const generateFCPXML = useCallback(() => {
    const fps = 30;
    const totalFrames = Math.ceil(audioDuration * fps);
    const basePath = folderPath ? `file://localhost/${folderPath}/` : "./";

    let imageAssets = "";
    let imageClips = "";
    let offset = 0;

    for (const entry of timeline) {
      const durFrames = Math.round((entry.end - entry.start) * fps);
      const startFrames = Math.round(entry.start * fps);
      imageAssets += `        <asset id="image_${entry.index}" name="${entry.index}.jpeg" src="${basePath}${entry.index}.jpeg" hasVideo="1" format="r1" />\n`;
      imageClips += `            <asset-clip ref="image_${entry.index}" offset="${startFrames}/${fps}s" duration="${durFrames}/${fps}s" name="${entry.index}.jpeg" />\n`;
      offset += durFrames;
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
                    <asset-clip ref="audio_1" offset="0/${fps}s" duration="${totalFrames}/${fps}s" name="${audioFilename}" lane="-1" />
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
  }, [timeline, audioDuration, folderPath]);

  const doneCount = timeline.filter((t) => t.status === "done").length;
  const totalCount = timeline.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-2 text-xl font-bold">Automated Pipeline</h1>
      <p className="mb-6 text-sm text-neutral-500">Audio → Transcript → Timeline → Images → FCPXML</p>

      {/* Step indicator */}
      <div className="mb-6 flex gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
              step === s
                ? "bg-blue-600 text-white"
                : s < step
                ? "bg-green-900/40 text-green-400 cursor-pointer hover:bg-green-900/60"
                : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {s === 1 && "Folder"}
            {s === 2 && "Transcribe"}
            {s === 3 && "Timeline"}
            {s === 4 && "Images"}
            {s === 5 && "Export"}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 border border-red-800/50 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Step 1: Folder */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Select Project Folder</h2>
          <p className="text-xs text-neutral-500">
            Choose the folder where your <code className="text-neutral-400">{audioFilename}</code> lives and where images will be saved.
          </p>
          <input
            type="file"
            /* @ts-expect-error webkitdirectory is non-standard */
            webkitdirectory=""
            onChange={handleFolderSelect}
            className="block w-full text-sm text-neutral-400 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-800 file:px-4 file:py-2 file:text-sm file:text-neutral-300 hover:file:bg-neutral-700"
          />
          {folderPath && (
            <div className="rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2">
              <span className="text-xs text-neutral-400">Selected: </span>
              <span className="text-xs text-white font-mono">{folderPath}/</span>
            </div>
          )}
          <div className="rounded-md bg-yellow-900/20 border border-yellow-800/40 px-3 py-2 text-xs text-yellow-400">
            Make sure <code>{audioFilename}</code> already exists in this folder.
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!folderPath}
            className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {/* Step 2: Transcribe */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Transcribe Audio</h2>
          <p className="text-xs text-neutral-500">Upload your audio file to transcribe with Deepgram Nova-2.</p>
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,video/mp4"
            onChange={(e) => e.target.files && handleTranscribe(e.target.files)}
            className="block w-full text-sm text-neutral-400 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-800 file:px-4 file:py-2 file:text-sm file:text-neutral-300 hover:file:bg-neutral-700"
          />
          {isTranscribing && (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Transcribing...
            </div>
          )}
          {words.length > 0 && (
            <>
              <div className="text-xs text-neutral-400">
                Duration: {formatTime(audioDuration)} · {words.length} words
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 p-3 text-sm leading-relaxed">
                {words.map((w, i) => (
                  <span key={i}>
                    {i > 0 && w.start - words[i - 1].end > 0.5 && <br />}
                    {(i === 0 || w.start - words[i - 1].end > 0.5) && (
                      <span className="mr-2 text-xs text-neutral-600">[{formatTime(w.start)}]</span>
                    )}
                    <span className="text-neutral-300">{w.word} </span>
                  </span>
                ))}
              </div>
              <button
                onClick={() => setStep(3)}
                className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500"
              >
                Next
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 3: Timeline */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Generate Timeline with Kimi K2.5</h2>
          <textarea
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
            placeholder="Style/direction prompt, e.g. 'cartoony illustrations' or 'cinematic photorealistic scenes' or 'new image every 4 seconds'..."
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500"
            rows={3}
          />
          <button
            onClick={handleGenerateTimeline}
            disabled={isGeneratingTimeline}
            className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {isGeneratingTimeline ? "Generating..." : "Generate Timeline"}
          </button>

          {timeline.length > 0 && (
            <>
              {/* Visual timeline bar */}
              <div className="rounded-md bg-neutral-900 p-2">
                <div className="relative h-8 rounded bg-neutral-800 overflow-hidden">
                  {timeline.map((t) => (
                    <div
                      key={t.index}
                      className="absolute top-0 bottom-0 bg-blue-600/60 border-r border-neutral-700"
                      style={{
                        left: `${(t.start / audioDuration) * 100}%`,
                        width: `${((t.end - t.start) / audioDuration) * 100}%`,
                      }}
                    >
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/80">
                        {t.index}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-neutral-600">
                  <span>0:00</span>
                  <span>{formatTime(audioDuration)}</span>
                </div>
              </div>

              {/* Timeline table */}
              <div className="space-y-2">
                {timeline.map((t) => (
                  <div key={t.index} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                    <div className="mb-2 flex items-center gap-3">
                      <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-400">
                        {t.index}.jpeg
                      </span>
                      <span className="text-xs text-neutral-500">
                        {formatTime(t.start)} → {formatTime(t.end)}
                      </span>
                      <span className="text-xs text-neutral-600">
                        ({(t.end - t.start).toFixed(1)}s)
                      </span>
                    </div>
                    <textarea
                      value={t.prompt}
                      onChange={(e) =>
                        setTimeline((prev) =>
                          prev.map((x) => (x.index === t.index ? { ...x, prompt: e.target.value } : x))
                        )
                      }
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white"
                      rows={2}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={() => setStep(4)}
                className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500"
              >
                Next: Generate Images
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 4: Image Generation */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Generate Images</h2>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-full bg-neutral-800 h-2">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all"
                style={{ width: totalCount > 0 ? `${(doneCount / totalCount) * 100}%` : "0%" }}
              />
            </div>
            <span className="text-xs text-neutral-400">{doneCount}/{totalCount}</span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleGenerateImages}
              disabled={isGeneratingImages}
              className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {isGeneratingImages ? "Generating..." : "Generate All"}
            </button>
            {doneCount > 0 && (
              <button
                onClick={downloadAllImages}
                className="cursor-pointer rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white"
              >
                Download All
              </button>
            )}
          </div>

          {/* Image grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {timeline.map((entry) => (
              <div key={entry.index} className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-mono text-neutral-500">{entry.index}.jpeg</span>
                  <span className="text-[10px] text-neutral-600">{formatTime(entry.start)}</span>
                </div>

                {entry.status === "idle" && (
                  <div className="flex aspect-video items-center justify-center rounded bg-neutral-900 text-xs text-neutral-600">
                    Waiting
                  </div>
                )}
                {entry.status === "generating" && (
                  <div className="flex aspect-video items-center justify-center rounded bg-neutral-900">
                    <svg className="h-5 w-5 animate-spin text-neutral-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </div>
                )}
                {entry.status === "done" && entry.image && (
                  <img
                    src={`data:${entry.mimeType};base64,${entry.image}`}
                    alt={`${entry.index}`}
                    className="w-full cursor-pointer rounded"
                    onClick={() => setPreviewSrc(`data:${entry.mimeType};base64,${entry.image}`)}
                  />
                )}
                {entry.status === "failed" && (
                  <div
                    onClick={() => retryImage(entry.index)}
                    className="flex aspect-video cursor-pointer items-center justify-center rounded bg-red-900/20 text-xs text-red-400 hover:bg-red-900/30"
                  >
                    Failed — click to retry
                  </div>
                )}

                {entry.status === "done" && (
                  <button
                    onClick={() => downloadImage(entry)}
                    className="mt-1 w-full cursor-pointer rounded bg-neutral-800 py-1 text-[10px] text-neutral-400 hover:text-white"
                  >
                    Download
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setStep(5)}
            disabled={doneCount === 0}
            className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Next: Export FCPXML
          </button>
        </div>
      )}

      {/* Step 5: Export */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Export FCPXML</h2>
          <p className="text-xs text-neutral-500">
            Download the FCPXML file for DaVinci Resolve. Format: 1920x1080 @ 30fps.
          </p>

          <button
            onClick={generateFCPXML}
            className="cursor-pointer rounded-md bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-500"
          >
            Download .fcpxml
          </button>

          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 space-y-2">
            <h3 className="text-xs font-medium text-neutral-300">Checklist</h3>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" className="rounded" />
              Download all images to <code className="text-neutral-300">{folderPath}/</code>
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" className="rounded" />
              Ensure <code className="text-neutral-300">{audioFilename}</code> is in the folder
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" className="rounded" />
              Import the .fcpxml into DaVinci Resolve
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" className="rounded" />
              Relink media if needed (right-click → Relink Selected Clips)
            </label>
          </div>

          {doneCount < totalCount && (
            <div className="rounded-md bg-yellow-900/20 border border-yellow-800/40 px-3 py-2 text-xs text-yellow-400">
              Warning: {totalCount - doneCount} images haven&apos;t been generated yet. Go back to Step 4 to complete them.
            </div>
          )}
        </div>
      )}

      {previewSrc && <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />}
    </div>
  );
}
