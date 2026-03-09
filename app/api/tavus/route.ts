import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.TAVUS_API_KEY;
  const personaId = process.env.TAVUS_PERSONA_ID;
  const replicaId = process.env.TAVUS_REPLICA_ID;

  if (!apiKey || !personaId) {
    return NextResponse.json({ error: "Missing TAVUS_API_KEY or TAVUS_PERSONA_ID" }, { status: 500 });
  }

  // Ensure persona is in echo mode (disables built-in LLM so avatar only speaks via conversation.echo)
  try {
    await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify([
        { op: "replace", path: "/pipeline_mode", value: "echo" },
      ]),
    });
  } catch (e) {
    console.warn("[tavus] Failed to patch persona to echo mode:", e);
  }

  const response = await fetch("https://tavusapi.com/v2/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      persona_id: personaId,
      ...(replicaId ? { replica_id: replicaId } : {}),
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
