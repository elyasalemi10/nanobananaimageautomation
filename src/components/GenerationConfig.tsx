"use client";

import { useState } from "react";
import { useGeneration } from "@/context/GenerationContext";

export default function GenerationConfig() {
  const { config, setConfig } = useGeneration();
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-950">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-neutral-300 hover:text-white"
      >
        <span>Generation Config</span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="flex flex-wrap gap-4 border-t border-neutral-800 px-4 py-3">
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Aspect Ratio
            <select
              value={config.aspectRatio}
              onChange={(e) =>
                setConfig({ ...config, aspectRatio: e.target.value as typeof config.aspectRatio })
              }
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-white"
            >
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-neutral-400">
            Resolution
            <select
              value={config.resolution}
              onChange={(e) =>
                setConfig({ ...config, resolution: e.target.value as typeof config.resolution })
              }
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-white"
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
