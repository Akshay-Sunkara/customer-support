import { NextResponse } from "next/server";

export async function POST(req: Request) {
  console.log("[tavus-api] POST /api/tavus called");
  const apiKey = process.env.TAVUS_API_KEY;
  const personaId = process.env.TAVUS_PERSONA_ID;
  const replicaId = process.env.TAVUS_REPLICA_ID;

  console.log("[tavus-api] Config check — API key:", apiKey ? `present (${apiKey.slice(0, 6)}...)` : "MISSING", "| personaId:", personaId || "MISSING", "| replicaId:", replicaId || "MISSING");

  if (!apiKey || !replicaId) {
    console.error("[tavus-api] Missing TAVUS_API_KEY or TAVUS_REPLICA_ID — returning 500");
    return NextResponse.json({ error: "Missing TAVUS_API_KEY or TAVUS_REPLICA_ID" }, { status: 500 });
  }

  // Step 1: Create (or update) an echo-only persona — no LLM, no STT, completely silent
  let echoPersonaId = personaId;
  try {
    // PATCH existing persona to echo mode
    if (personaId) {
      console.log("[tavus-api] PATCHing persona to echo mode:", personaId);
      const patchRes = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ pipeline_mode: "echo" }),
      });
      const patchData = await patchRes.text();
      console.log("[tavus-api] Persona PATCH status:", patchRes.status, "response:", patchData.slice(0, 500));
      if (!patchRes.ok) {
        console.warn("[tavus-api] PATCH failed, will create a new echo persona");
        echoPersonaId = null;
      }
    }

    // If no persona or PATCH failed, create a fresh echo persona
    if (!echoPersonaId) {
      console.log("[tavus-api] Creating new echo persona...");
      const createRes = await fetch("https://tavusapi.com/v2/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          persona_name: "Ceres Echo",
          pipeline_mode: "echo",
        }),
      });
      const createData = await createRes.json();
      console.log("[tavus-api] Create persona status:", createRes.status, "response:", JSON.stringify(createData).slice(0, 500));
      if (createRes.ok && createData.persona_id) {
        echoPersonaId = createData.persona_id;
      } else {
        console.error("[tavus-api] Failed to create echo persona:", createData);
        return NextResponse.json({ error: "Failed to create echo persona", details: createData }, { status: 500 });
      }
    }
  } catch (e) {
    console.error("[tavus-api] Persona setup failed:", e);
  }

  // Step 2: Create conversation with the echo persona — no custom_greeting
  try {
    const conversationBody = {
      persona_id: echoPersonaId,
      replica_id: replicaId,
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
      console.error("[tavus-api] Tavus API returned non-OK status:", response.status);
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
