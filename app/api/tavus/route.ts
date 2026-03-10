import { NextResponse } from "next/server";

export async function POST(req: Request) {
  console.log("[tavus-api] POST /api/tavus called");
  const apiKey = process.env.TAVUS_API_KEY;
  const personaId = process.env.TAVUS_PERSONA_ID;
  const replicaId = process.env.TAVUS_REPLICA_ID;

  console.log("[tavus-api] Config check — API key:", apiKey ? `present (${apiKey.slice(0, 6)}...)` : "MISSING", "| personaId:", personaId || "MISSING", "| replicaId:", replicaId || "MISSING");

  if (!apiKey || !personaId) {
    console.error("[tavus-api] Missing TAVUS_API_KEY or TAVUS_PERSONA_ID — returning 500");
    return NextResponse.json({ error: "Missing TAVUS_API_KEY or TAVUS_PERSONA_ID" }, { status: 500 });
  }

  // Ensure persona is in echo mode AND silence its built-in LLM
  try {
    console.log("[tavus-api] PATCHing persona to echo mode:", `https://tavusapi.com/v2/personas/${personaId}`);
    const patchRes = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        pipeline_mode: "echo",
        system_prompt: "You are in echo-only mode. Do NOT generate any responses to user speech. Stay completely silent. Never speak unless text is sent via the echo API. If the user speaks, do nothing. Say absolutely nothing on your own.",
        context: "",
      }),
    });
    const patchData = await patchRes.text();
    console.log("[tavus-api] Persona PATCH status:", patchRes.status, "response:", patchData.slice(0, 500));
  } catch (e) {
    console.error("[tavus-api] Failed to patch persona to echo mode:", e);
  }

  try {
    const conversationBody = {
      persona_id: personaId,
      ...(replicaId ? { replica_id: replicaId } : {}),
      properties: {
        max_call_duration: 600,
        enable_transcription: true,
      },
    };
    console.log("[tavus-api] Creating conversation:", JSON.stringify(conversationBody, null, 2));

    const response = await fetch("https://tavusapi.com/v2/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(conversationBody),
    });

    console.log("[tavus-api] Conversation create status:", response.status, response.statusText);
    const data = await response.json();
    console.log("[tavus-api] Conversation response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("[tavus-api] Tavus API returned non-OK status:", response.status, "— returning error to client");
      return NextResponse.json({ error: data.message || data.error || `Tavus API error ${response.status}`, details: data }, { status: response.status });
    }

    if (!data.conversation_url) {
      console.error("[tavus-api] Response missing conversation_url! Full response:", JSON.stringify(data));
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("[tavus-api] Failed to create conversation:", e);
    return NextResponse.json({ error: "Failed to create Tavus conversation", details: String(e) }, { status: 500 });
  }
}
