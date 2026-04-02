import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const MODEL_DIR = join(process.cwd(), "public", "models");
const MODEL_PATH = join(MODEL_DIR, "lama_fp32.onnx");
const DRIVE_ID = "16cRZWEQyJFecg77ebUBXjFxAik0iFU_C";
const URL = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&confirm=t`;

async function download() {
  if (existsSync(MODEL_PATH)) {
    console.log("Model already exists, skipping download.");
    return;
  }

  mkdirSync(MODEL_DIR, { recursive: true });
  console.log("Downloading LaMa model (~200MB)...");

  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const buffer = await res.arrayBuffer();
  writeFileSync(MODEL_PATH, Buffer.from(buffer));
  console.log(`Model saved to ${MODEL_PATH} (${(buffer.byteLength / 1e6).toFixed(1)}MB)`);
}

download().catch((err) => {
  console.error("Model download failed:", err.message);
  console.error("You can manually download from Google Drive and place at public/models/lama_fp32.onnx");
  process.exit(1);
});
