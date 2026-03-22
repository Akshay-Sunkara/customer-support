import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a concise customer support assistant. If a custom prompt is provided above, use the name and persona defined there; otherwise introduce yourself as N22. Your responses are SPOKEN ALOUD via TTS.

RULES:
- Return valid JSON: {"speech":"...","action":"none","done":false}
- "speech" = 1-2 short sentences max. Be direct. No filler.
- Never echo the user's question back. Jump straight to the answer.
- Never say "I've highlighted" or "I'm pointing to" — just describe where things are.
- If screen shared: call highlight_element whenever you tell the user to click, tap, open, or navigate to something visible on screen. This includes buttons, links, icons, tabs, menu items, or any element you're directing them toward. Do NOT highlight for non-actionable responses like confirmations ("yes I can see your screen"), general questions, or greetings.
- If NO screen shared: never reference highlighting. Ask them to share their screen if they need visual help.
- Set action to "done" when task is complete.
- After giving an instruction, always end with something like "Let me know when you're done" or "Tell me when you're ready for the next step" so the user knows to respond before you continue.
- If the customer asks for remote access, remote control, remote help, or says they want someone to connect to their computer — IMMEDIATELY use the create_remote_session tool. Do not ask follow-up questions first.
- Also use create_remote_session for complex setup, installation, or fixing things they can't navigate on their own.`;

const HIGHLIGHT_TOOL = {
  name: "highlight_element",
  description: "Point to a UI element on the user's screen.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "Visual description of the element to find" },
      action_label: { type: "string" as const, description: "Short instruction, under 6 words" },
    },
    required: ["query", "action_label"],
  },
};

const REMOTE_DESKTOP_TOOL = {
  name: "create_remote_session",
  description: "When the customer needs hands-on help that requires you to control their computer (e.g., software installation, complex configuration, fixing settings they can't navigate themselves), use this tool to generate a remote support session. This gives them a command to run that lets your team take control of their screen. Only use this when guiding them visually isn't enough and you actually need to do it for them.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: { type: "string" as const, description: "Brief reason why remote control is needed" },
    },
    required: ["reason"],
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ speech: "Connection issue.", action: "none", done: false });
  }

  const { screenshot, userMessage, dialogue, stepHistory, isFollowUp, customPrompt, roomId } = await req.json();
  const hasScreen = !!screenshot;

  // Build content — minimal context
  const context: string[] = [];
  if (!hasScreen) context.push("[No screen shared]");
  else context.push("[Screen shared — the attached image is the user's screen]");

  if (dialogue?.length > 0) {
    const recent = dialogue.slice(-6);
    context.push("Recent: " + recent.map((d: any) => `${d.role === "user" ? "U" : "C"}: ${d.text.slice(0, 80)}`).join(" | "));
  }
  if (stepHistory?.length > 0) context.push("Already told: " + stepHistory.slice(-3).map((s: string) => s.slice(0, 50)).join("; "));
  if (isFollowUp) context.push("(follow-up — give next step)");

  const content: any[] = [];
  if (hasScreen) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot } });
  content.push({ type: "text", text: `${context.join("\n")}\n\nUser: "${userMessage}"` });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        system: customPrompt ? `${customPrompt}\n\n${SYSTEM_PROMPT}` : SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        tools: [
          ...(hasScreen ? [HIGHLIGHT_TOOL] : []),
          REMOTE_DESKTOP_TOOL,
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();

    let speech = "";
    let action = "none";
    let done = false;
    let highlightQuery: string | null = null;
    let actionLabel: string | null = null;
    let toolUseBlock: any = null;

    for (const block of data.content || []) {
      if (block.type === "text") {
        const m = block.text.match(/\{[\s\S]*\}/);
        if (m) { try { const p = JSON.parse(m[0]); if (p.speech) speech = p.speech; if (p.action) action = p.action; if (p.done) done = p.done; } catch {} }
        if (!speech) { const c = block.text.replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*?\}/g, "").trim(); if (c) speech = c; }
      } else if (block.type === "tool_use" && block.name === "highlight_element") {
        highlightQuery = block.input?.query || null;
        actionLabel = block.input?.action_label || null;
        toolUseBlock = block;
      } else if (block.type === "tool_use" && block.name === "create_remote_session") {
        // Create a remote desktop session via the dashboard API
        const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || "https://n22.ai";
        const internalKey = process.env.INTERNAL_API_KEY || "";
        let installUrl = "";
        let installCmd = "";
        try {
          const sessionRes = await fetch(`${dashboardUrl}/api/remote-desktop/create-public`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": internalKey },
            body: JSON.stringify({ customerName: "Customer", roomId }),
          });
          const sessionData = await sessionRes.json();
          if (sessionData.sessionId) {
            installUrl = sessionData.installUrl;
            installCmd = `curl -fsSL '${dashboardUrl}/installers/install-n22-support.sh' | bash -s -- --token '${sessionData.sessionId}' --server '${dashboardUrl}'`;
          }
        } catch (err) {
          console.error("[process] Remote session creation failed:", err);
        }

        if (installUrl) {
          speech = `I'll connect to your computer to help with this. Click the link I'm sending in the chat, download the file, and open it. Let me know once it says the session is active.`;
        } else {
          speech = `I'd like to connect to your screen to help, but I'm having trouble setting that up right now. Let me try to guide you through it instead.`;
        }
        return NextResponse.json({ speech, action: "none", done: false, highlightQuery: null, actionLabel: null, remoteInstallUrl: installUrl });
      }
    }

    // If tool was called, get spoken response in one fast follow-up
    if (toolUseBlock && data.stop_reason === "tool_use") {
      try {
        const f = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 150,
            system: "Give a 1-sentence spoken direction. Describe WHERE the element is and what to do. No highlighting references.",
            messages: [
              { role: "user", content },
              { role: "assistant", content: data.content },
              { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: "Cursor is pointing at it now." }] },
            ],
          }),
          signal: AbortSignal.timeout(10000),
        });
        const fd = await f.json();
        for (const block of fd.content || []) {
          if (block.type === "text") {
            const m = block.text.match(/\{[\s\S]*\}/);
            if (m) { try { const p = JSON.parse(m[0]); if (p.speech) speech = p.speech; } catch {} }
            if (!speech) { const c = block.text.replace(/\{[\s\S]*?\}/g, "").trim(); if (c) speech = c; }
          }
        }
      } catch {}
    }

    if (!speech) speech = "How can I help?";

    return NextResponse.json({ speech, action, done, highlightQuery, actionLabel });
  } catch (e) {
    console.error("[process]", e);
    return NextResponse.json({ speech: "Sorry, say that again?", action: "none", done: false, highlightQuery: null });
  }
}
