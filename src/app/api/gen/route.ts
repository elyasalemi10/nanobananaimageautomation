import { GoogleAuth } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";

// Fallback chain: try models in order if one is rate-limited
const MODELS = [
  "gemini-3.1-flash-image-preview",
  "nano-banana-pro-preview",
  "gemini-2.5-flash-image",
];
const MAX_RETRIES = 3;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelay(errorBody: string): number {
  try {
    const parsed = JSON.parse(errorBody);
    const retryInfo = parsed.error?.details?.find(
      (d: { "@type"?: string }) => d["@type"]?.includes("RetryInfo")
    );
    if (retryInfo?.retryDelay) {
      const seconds = parseFloat(retryInfo.retryDelay);
      if (!isNaN(seconds)) return Math.ceil(seconds * 1000);
    }
  } catch { /* ignore */ }
  return 0;
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

  const requestBody = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: "16:9",
      },
    },
  });

  // Try each model with retries
  let lastError = "";
  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      try {
        const apiResponse = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: requestBody,
        });

        if (apiResponse.ok) {
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
                model,
              });
            }
          }

          return NextResponse.json(
            { error: "The model did not return an image. It may have been blocked by content policy." },
            { status: 422 }
          );
        }

        const errBody = await apiResponse.text();

        // Rate limited — check for retry delay
        if (apiResponse.status === 429) {
          const retryMs = parseRetryDelay(errBody);
          // If retry delay is short enough (< 15s) and we have retries left, wait and retry same model
          if (retryMs > 0 && retryMs <= 15000 && attempt < MAX_RETRIES - 1) {
            console.log(`Rate limited on ${model}, retrying in ${retryMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await sleep(retryMs);
            continue;
          }
          // Otherwise try next model
          lastError = `Rate limited on ${model}`;
          console.log(`Rate limited on ${model}, trying next model`);
          break;
        }

        // Non-429 error — return immediately
        console.error("Gemini API error:", apiResponse.status, errBody);
        return NextResponse.json(
          { error: `API error (${apiResponse.status}): ${errBody}` },
          { status: apiResponse.status }
        );
      } catch (err) {
        console.error(`Error with ${model} attempt ${attempt + 1}:`, err);
        lastError = err instanceof Error ? err.message : "Unknown error";
        if (attempt < MAX_RETRIES - 1) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }

  return NextResponse.json(
    { error: `All models rate limited. Please wait a minute and try again. (${lastError})` },
    { status: 429 }
  );
}
