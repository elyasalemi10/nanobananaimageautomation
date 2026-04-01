import fs from "fs";
import { NextRequest, NextResponse } from "next/server";

// This MUST run before @google/genai is imported — the SDK resolves
// credentials at import time via GOOGLE_APPLICATION_CREDENTIALS.
// ESM static imports are hoisted, so we use dynamic import() below instead.
const keyPath = "/tmp/service-account-key.json";
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
}

const RESOLUTION_MAP: Record<string, string> = {
  "1K": "1024x1024",
  "2K": "2048x2048",
  "4K": "4096x4096",
};

export async function POST(req: NextRequest) {
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return NextResponse.json(
      { error: "Server misconfigured: missing Google Cloud credentials" },
      { status: 500 }
    );
  }

  let body: {
    prompt: string;
    referenceImages?: { base64: string; mimeType: string }[];
    aspectRatio?: string;
    resolution?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  // Dynamic import — credentials are already written to /tmp above
  const { GoogleGenAI } = await import("@google/genai");

  const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || "global",
  });

  // Build contents array
  const contents: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: body.prompt }];

  if (body.referenceImages && Array.isArray(body.referenceImages)) {
    for (const img of body.referenceImages) {
      if (img.base64 && img.mimeType) {
        contents.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64,
          },
        });
      }
    }
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: body.aspectRatio || "16:9",
          imageSize: RESOLUTION_MAP[body.resolution || "2K"] || "2048x2048",
        },
      },
    });

    // Find the image part in the response
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      return NextResponse.json(
        { error: "No response from the model" },
        { status: 502 }
      );
    }

    for (const part of parts) {
      if (part.inlineData) {
        return NextResponse.json({
          image: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
    }

    return NextResponse.json(
      { error: "The model did not return an image. It may have been blocked by content policy." },
      { status: 422 }
    );
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    console.error("Gemini API error:", error);

    if (error.status === 429) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment and try again." },
        { status: 429 }
      );
    }
    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { error: "Invalid or unauthorized API key." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Image generation failed" },
      { status: 500 }
    );
  }
}
