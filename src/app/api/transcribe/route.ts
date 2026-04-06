import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing DEEPGRAM_API_KEY" },
      { status: 500 }
    );
  }

  const contentType = req.headers.get("content-type") || "audio/mp4";
  const body = await req.arrayBuffer();

  if (!body || body.byteLength === 0) {
    return NextResponse.json({ error: "No audio data provided" }, { status: 400 });
  }

  try {
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&timestamps=true&punctuate=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body: Buffer.from(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Deepgram error:", res.status, errText);
      return NextResponse.json(
        { error: `Deepgram error (${res.status}): ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const words =
      data.results?.channels?.[0]?.alternatives?.[0]?.words?.map(
        (w: { word: string; punctuated_word?: string; start: number; end: number }) => ({
          word: w.punctuated_word || w.word,
          start: w.start,
          end: w.end,
        })
      ) || [];

    const duration =
      data.metadata?.duration ||
      data.results?.channels?.[0]?.alternatives?.[0]?.words?.slice(-1)?.[0]?.end ||
      0;

    return NextResponse.json({ words, duration });
  } catch (err) {
    console.error("Transcription error:", err);
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
