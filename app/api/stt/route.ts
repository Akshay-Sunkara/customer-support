import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing DEEPGRAM_API_KEY" }, { status: 500 });
  }

  try {
    const audioBlob = await req.arrayBuffer();
    if (audioBlob.byteLength === 0) {
      return NextResponse.json({ transcript: "" });
    }

    const contentType = req.headers.get("content-type") || "audio/webm";

    const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&language=en&punctuate=true&smart_format=true", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: audioBlob,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[stt] Deepgram error:", res.status, err);
      return NextResponse.json({ error: "STT failed" }, { status: res.status });
    }

    const data = await res.json();
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    return NextResponse.json({ transcript });
  } catch (e) {
    console.error("[stt] Error:", e);
    return NextResponse.json({ error: "STT error" }, { status: 500 });
  }
}
