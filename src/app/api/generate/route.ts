import { GoogleAuth } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT!;
const LOCATION = "us-central1"; // Imagen requires a regional endpoint
const MODEL = "imagen-3.0-generate-002";

function getAuth(): GoogleAuth {
  // On Vercel: parse credentials from env var
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  // Locally: use GOOGLE_APPLICATION_CREDENTIALS file
  return new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
}

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

  try {
    const auth = getAuth();
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT()}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

    const apiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: body.prompt,
          },
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: body.aspectRatio || "16:9",
        },
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text();
      console.error("Vertex AI error:", apiResponse.status, errBody);
      return NextResponse.json(
        { error: `Vertex AI error (${apiResponse.status}): ${errBody}` },
        { status: apiResponse.status }
      );
    }

    const data = await apiResponse.json();
    const predictions = data.predictions;

    if (!predictions || predictions.length === 0) {
      return NextResponse.json(
        { error: "The model did not return an image. It may have been blocked by content policy." },
        { status: 422 }
      );
    }

    const imageBytes = predictions[0].bytesBase64Encoded;
    const mimeType = predictions[0].mimeType || "image/png";

    if (!imageBytes) {
      return NextResponse.json(
        { error: "The model did not return image data." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      image: imageBytes,
      mimeType,
    });
  } catch (err: unknown) {
    console.error("Generation error:", err);
    const message = err instanceof Error ? err.message : "Image generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
