import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing MOONSHOT_API_KEY" },
      { status: 500 }
    );
  }

  let body: { transcript: string; audioDuration: number; stylePrompt: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.transcript || !body.audioDuration) {
    return NextResponse.json({ error: "transcript and audioDuration are required" }, { status: 400 });
  }

  const systemPrompt = `You are a visual director creating an image timeline for a video.

CREATIVE DIRECTION: ${body.stylePrompt || "cinematic, visually striking images that match the spoken content"}

The audio is exactly ${body.audioDuration.toFixed(1)} seconds long.

Your timeline MUST cover the ENTIRE audio duration. The last image's end time must be >= ${body.audioDuration.toFixed(1)} seconds. There must be NO gaps in the timeline — every second of the audio must be covered by an image.

Output ONLY a valid JSON array, no markdown, no explanation, no code fences. Each element:
{"start": seconds_float, "end": seconds_float, "prompt": "detailed image generation prompt incorporating the style direction"}

The prompts should be vivid, detailed descriptions of scenes that match what is being said at that time in the audio. Each prompt should incorporate the creative direction style.`;

  try {
    const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kimi-k2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.transcript },
        ],
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Moonshot error:", res.status, errText);
      return NextResponse.json(
        { error: `Moonshot error (${res.status}): ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (strip markdown fences if present)
    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    let timeline: Array<{ start: number; end: number; prompt: string }>;
    try {
      timeline = JSON.parse(jsonStr);
      if (!Array.isArray(timeline)) throw new Error("Not an array");
    } catch {
      return NextResponse.json(
        { error: "Failed to parse timeline from AI response", raw: content },
        { status: 422 }
      );
    }

    // Validate and fix: ensure last entry covers full duration
    if (timeline.length > 0) {
      const last = timeline[timeline.length - 1];
      if (last.end < body.audioDuration) {
        last.end = body.audioDuration;
      }
    }

    return NextResponse.json({ timeline });
  } catch (err) {
    console.error("Timeline generation error:", err);
    const message = err instanceof Error ? err.message : "Timeline generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
