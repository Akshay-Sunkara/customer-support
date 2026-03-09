import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.TAVUS_API_KEY;
  const personaId = process.env.TAVUS_PERSONA_ID;

  if (!apiKey || !personaId) {
    return NextResponse.json({ error: "Missing TAVUS_API_KEY or TAVUS_PERSONA_ID" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const userName = body.userName || "there";

  const response = await fetch("https://tavusapi.com/v2/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      persona_id: personaId,
      conversational_context: `You are Ceres, a friendly avatar. The user's name is "${userName}". Your ONLY job is to speak what you're told.
Rules:
- When you receive a message, say it word for word in a natural, warm tone. Do NOT add anything.
- If you don't receive a scripted line, just say "Hmm, one moment" and wait.
- NEVER make up answers, give advice, or respond to questions on your own.
- NEVER repeat or echo back what the user just said. Do NOT rephrase their question back to them.
- Be warm and friendly in your TONE, but only say what you're told to say.`,
      properties: {
        max_call_duration: 600,
        enable_transcription: true,
      },
    }),
  });

  const data = await response.json();
  console.log("[tavus] Response:", JSON.stringify(data, null, 2));
  return NextResponse.json(data);
}
