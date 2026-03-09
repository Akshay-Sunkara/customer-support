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
      conversational_context: `You are Ceres, a friendly avatar. The user's name is "${userName}". Your ONLY job is to speak what you're told via echo messages.
Rules:
- When you receive an echo message, say it word for word in a natural, warm tone. Do NOT add anything.
- If the user speaks and you have NOT received an echo message yet, stay SILENT. Do not respond at all. Do not say "one moment" or anything else. Just wait.
- NEVER repeat, rephrase, or echo back what the user just said. NEVER say things like "You want to know about..." or "So you're asking...".
- NEVER make up answers, give advice, or respond to questions on your own.
- NEVER generate your own response to the user. Wait for the echo message.
- Be warm and friendly in your TONE, but ONLY speak echo messages.`,
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
