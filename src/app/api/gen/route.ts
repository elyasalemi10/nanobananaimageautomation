import { GoogleAuth } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

const MODEL = "gemini-3.1-flash-image-preview";

function getAuth(): GoogleAuth {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/generative-language"],
    });
  }
  return new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/generative-language"],
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return NextResponse.json(
      { error: "Server misconfigured: missing credentials" },
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
    const token = (await client.getAccessToken()).token;

    // Build parts: text prompt + reference images
    const parts: Array<Record<string, unknown>> = [{ text: body.prompt }];

    if (body.referenceImages && Array.isArray(body.referenceImages)) {
      for (const img of body.referenceImages) {
        if (img.base64 && img.mimeType) {
          parts.push({
            inlineData: { mimeType: img.mimeType, data: img.base64 },
          });
        }
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    const apiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text();
      console.error("Gemini API error:", apiResponse.status, errBody);
      return NextResponse.json(
        { error: `API error (${apiResponse.status}): ${errBody}` },
        { status: apiResponse.status }
      );
    }

    const data = await apiResponse.json();
    const responseParts = data.candidates?.[0]?.content?.parts;

    if (!responseParts) {
      return NextResponse.json(
        { error: "No response from the model" },
        { status: 502 }
      );
    }

    for (const part of responseParts) {
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
    console.error("Generation error:", err);
    const message = err instanceof Error ? err.message : "Image generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
