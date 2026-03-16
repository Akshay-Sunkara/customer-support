import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID || "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc";

  if (!apiKey) {
    return NextResponse.json({ error: "Missing CARTESIA_API_KEY" }, { status: 500 });
  }

  const { text } = await req.json();
  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2025-04-16",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-2",
        transcript: text,
        voice: { mode: "id", id: voiceId },
        output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
        language: "en",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[tts] Cartesia error:", res.status, err);
      return NextResponse.json({ error: "TTS failed" }, { status: res.status });
    }

    const audioBytes = await res.arrayBuffer();
    return new Response(audioBytes, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("[tts] Error:", e);
    return NextResponse.json({ error: "TTS error" }, { status: 500 });
  }
}
