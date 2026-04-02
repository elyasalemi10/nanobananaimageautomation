// Ported from https://github.com/dinoBOLT/Gemini-Watermark-Remover

// Try local first (works in dev), fall back to Google Drive CDN
const MODEL_URL_LOCAL = "/models/lama_fp32.onnx";
const MODEL_URL_REMOTE =
  "https://drive.usercontent.google.com/download?id=16cRZWEQyJFecg77ebUBXjFxAik0iFU_C&export=download&confirm=t";
const IDB_CACHE_KEY = "lama-model-v1";
const MODEL_INPUT_SIZE = 512;
const WATERMARK_HEIGHT_RATIO = 0.15;
const WATERMARK_WIDTH_RATIO = 0.15;

// IndexedDB cache for the model
async function getCachedModel(): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open("watermark-remover", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("models");
    req.onsuccess = () => {
      const tx = req.result.transaction("models", "readonly");
      const get = tx.objectStore("models").get(IDB_CACHE_KEY);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

async function cacheModel(buffer: ArrayBuffer): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open("watermark-remover", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("models");
    req.onsuccess = () => {
      const tx = req.result.transaction("models", "readwrite");
      tx.objectStore("models").put(buffer, IDB_CACHE_KEY);
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

async function fetchModel(
  url: string,
  onProgress?: (pct: number) => void
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load model from ${url}`);

  const contentLength = Number(res.headers.get("content-length")) || 0;
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress?.(Math.round((received / contentLength) * 100));
    }
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress?.(100);
  return buffer.buffer;
}

export async function loadModel(
  onProgress?: (pct: number) => void
): Promise<ArrayBuffer> {
  // Check IndexedDB cache first
  const cached = await getCachedModel();
  if (cached) {
    onProgress?.(100);
    return cached;
  }

  // Try local server first, fall back to Google Drive
  let buffer: ArrayBuffer;
  try {
    const check = await fetch(MODEL_URL_LOCAL, { method: "HEAD" });
    if (check.ok) {
      buffer = await fetchModel(MODEL_URL_LOCAL, onProgress);
    } else {
      throw new Error("Local not available");
    }
  } catch {
    buffer = await fetchModel(MODEL_URL_REMOTE, onProgress);
  }

  // Cache in IndexedDB for next time
  await cacheModel(buffer);
  return buffer;
}

function calculateWatermarkRegion(width: number, height: number) {
  const wmHeight = Math.round(height * WATERMARK_HEIGHT_RATIO);
  const wmWidth = Math.round(width * WATERMARK_WIDTH_RATIO);
  return {
    x: width - wmWidth,
    y: height - wmHeight,
    width: wmWidth,
    height: wmHeight,
  };
}

function preprocessImage(
  imageData: ImageData
): { imageTensor: Float32Array; maskTensor: Float32Array } {
  const { width, height, data } = imageData;
  const wm = calculateWatermarkRegion(width, height);

  const imageTensor = new Float32Array(3 * width * height);
  const maskTensor = new Float32Array(1 * width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixIdx = idx * 4;

      // CHW format, normalized to [0, 1]
      imageTensor[0 * width * height + idx] = data[pixIdx] / 255;
      imageTensor[1 * width * height + idx] = data[pixIdx + 1] / 255;
      imageTensor[2 * width * height + idx] = data[pixIdx + 2] / 255;

      // Mask: 1.0 for watermark region, 0.0 elsewhere
      const inWatermark = x >= wm.x && y >= wm.y;
      maskTensor[idx] = inWatermark ? 1.0 : 0.0;
    }
  }

  return { imageTensor, maskTensor };
}

function postprocessImage(
  output: Float32Array,
  width: number,
  height: number
): ImageData {
  const imageData = new ImageData(width, height);

  // Auto-detect value range
  let maxVal = 0;
  for (let i = 0; i < Math.min(output.length, 1000); i++) {
    if (output[i] > maxVal) maxVal = output[i];
  }
  const scale = maxVal > 2 ? 1 : 255;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixIdx = idx * 4;

      imageData.data[pixIdx] = Math.max(
        0,
        Math.min(255, Math.round(output[0 * width * height + idx] * scale))
      );
      imageData.data[pixIdx + 1] = Math.max(
        0,
        Math.min(255, Math.round(output[1 * width * height + idx] * scale))
      );
      imageData.data[pixIdx + 2] = Math.max(
        0,
        Math.min(255, Math.round(output[2 * width * height + idx] * scale))
      );
      imageData.data[pixIdx + 3] = 255;
    }
  }

  return imageData;
}

function composeFinalImage(
  originalCanvas: OffscreenCanvas,
  processedImageData: ImageData
): OffscreenCanvas {
  const width = originalCanvas.width;
  const height = originalCanvas.height;
  const wm = calculateWatermarkRegion(width, height);

  // Create processed canvas at model size
  const processedCanvas = new OffscreenCanvas(
    processedImageData.width,
    processedImageData.height
  );
  const processedCtx = processedCanvas.getContext("2d")!;
  processedCtx.putImageData(processedImageData, 0, 0);

  // Create output at original resolution
  const outputCanvas = new OffscreenCanvas(width, height);
  const outputCtx = outputCanvas.getContext("2d")!;

  // Draw original image
  outputCtx.drawImage(originalCanvas, 0, 0);

  // Calculate corresponding region in model-size image
  const scaleX = MODEL_INPUT_SIZE / width;
  const scaleY = MODEL_INPUT_SIZE / height;
  const srcX = Math.round(wm.x * scaleX);
  const srcY = Math.round(wm.y * scaleY);
  const srcW = MODEL_INPUT_SIZE - srcX;
  const srcH = MODEL_INPUT_SIZE - srcY;

  // Overlay the processed watermark region
  outputCtx.drawImage(
    processedCanvas,
    srcX,
    srcY,
    srcW,
    srcH,
    wm.x,
    wm.y,
    wm.width,
    wm.height
  );

  return outputCanvas;
}

export async function removeWatermark(
  file: File,
  modelBuffer: ArrayBuffer,
  onStatus?: (status: string) => void
): Promise<Blob> {
  onStatus?.("Loading image...");
  const bitmap = await createImageBitmap(file);
  const origWidth = bitmap.width;
  const origHeight = bitmap.height;

  // Draw original at full resolution
  const originalCanvas = new OffscreenCanvas(origWidth, origHeight);
  const originalCtx = originalCanvas.getContext("2d")!;
  originalCtx.drawImage(bitmap, 0, 0);

  // Resize to model input size
  onStatus?.("Preprocessing...");
  const resizedCanvas = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const resizedCtx = resizedCanvas.getContext("2d")!;
  resizedCtx.drawImage(bitmap, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const resizedData = resizedCtx.getImageData(
    0,
    0,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE
  );
  bitmap.close();

  const { imageTensor, maskTensor } = preprocessImage(resizedData);

  // Run ONNX inference
  onStatus?.("Running AI model...");
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";

  const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["wasm"],
  });

  const imageFeed = new ort.Tensor("float32", imageTensor, [
    1,
    3,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);
  const maskFeed = new ort.Tensor("float32", maskTensor, [
    1,
    1,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  ]);

  const results = await session.run({ image: imageFeed, mask: maskFeed });
  const outputTensor = Object.values(results)[0];
  const outputData = outputTensor.data as Float32Array;

  // Postprocess
  onStatus?.("Compositing...");
  const processedImageData = postprocessImage(
    outputData,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE
  );

  // Compose onto original resolution
  const finalCanvas = composeFinalImage(originalCanvas, processedImageData);

  // Convert to blob
  const blob = await finalCanvas.convertToBlob({ type: "image/png" });
  onStatus?.("Done");
  return blob;
}
