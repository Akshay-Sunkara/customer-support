import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing CARTESIA_API_KEY" }, { status: 500 });
  }

  try {
    const audioBlob = await req.arrayBuffer();
    if (audioBlob.byteLength === 0) {
      return NextResponse.json({ transcript: "" });
    }

    const contentType = req.headers.get("content-type") || "audio/webm";
    const ext = contentType.includes("mp4") ? "mp4" : contentType.includes("mpeg") ? "mp3" : "webm";

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioBlob], { type: contentType }),
      `audio.${ext}`,
    );
    formData.append("model", "ink-whisper");
    formData.append("language", "en");

    const res = await fetch("https://api.cartesia.ai/stt", {
      method: "POST",
      headers: {
        "Cartesia-Version": "2025-04-16",
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[stt] Cartesia error:", res.status, err);
      return NextResponse.json({ error: "STT failed" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ transcript: data.text || "" });
  } catch (e) {
    console.error("[stt] Error:", e);
    return NextResponse.json({ error: "STT error" }, { status: 500 });
  }
}
