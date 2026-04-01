import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const VALID_IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

export async function POST(req: NextRequest) {
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: missing GOOGLE_CLOUD_PROJECT or GOOGLE_SERVICE_ACCOUNT_KEY" },
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

  // Pass credentials directly — no filesystem, no GOOGLE_APPLICATION_CREDENTIALS
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  const ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    googleAuthOptions: { credentials },
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
          imageSize: VALID_IMAGE_SIZES.has(body.resolution || "2K") ? (body.resolution || "2K") : "2K",
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
    console.error("Gemini API error:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
    const error = err as { status?: number; message?: string; details?: unknown };
    const message = error.message || "Image generation failed";

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
      { error: message, details: error.details },
      { status: error.status || 500 }
    );
  }
}
