import { NextResponse } from "next/server";

export async function POST(req: Request) {
  console.log("[tavus-api] POST /api/tavus called");
  const apiKey = process.env.TAVUS_API_KEY;
  const personaId = process.env.TAVUS_PERSONA_ID;
  const replicaId = process.env.TAVUS_REPLICA_ID;

  console.log("[tavus-api] Config check — API key:", apiKey ? `present (${apiKey.slice(0, 6)}...)` : "MISSING", "| personaId:", personaId || "MISSING", "| replicaId:", replicaId || "MISSING");

  if (!apiKey) {
    console.error("[tavus-api] Missing TAVUS_API_KEY — returning 500");
    return NextResponse.json({ error: "Missing TAVUS_API_KEY" }, { status: 500 });
  }

  if (!replicaId) {
    console.error("[tavus-api] Missing TAVUS_REPLICA_ID — returning 500");
    return NextResponse.json({ error: "Missing TAVUS_REPLICA_ID" }, { status: 500 });
  }

  try {
    // Create conversation with replica only — NO persona to avoid Tavus's built-in LLM
    // We use echo commands to make the avatar speak our Claude responses
    const conversationBody = {
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
