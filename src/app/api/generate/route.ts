import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    return NextResponse.json(
      { error: "Server misconfigured: missing GOOGLE_CLOUD_PROJECT" },
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

  // Build GoogleGenAI options
  const aiOptions: Record<string, unknown> = {
    vertexai: true,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
  };

  // On Vercel: pass credentials from env var directly
  // Locally: SDK reads GOOGLE_APPLICATION_CREDENTIALS automatically
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    aiOptions.googleAuthOptions = { credentials };
  }

  const ai = new GoogleGenAI(aiOptions);

  try {
    const response = await ai.models.generateImages({
      model: "imagen-3.0-generate-002",
      prompt: body.prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: body.aspectRatio || "16:9",
      },
    });

    const generated = response.generatedImages?.[0];
    if (!generated?.image?.imageBytes) {
      const reason = generated?.raiFilteredReason;
      return NextResponse.json(
        { error: reason || "The model did not return an image. It may have been blocked by content policy." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      image: generated.image.imageBytes,
      mimeType: generated.image.mimeType || "image/png",
    });
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
