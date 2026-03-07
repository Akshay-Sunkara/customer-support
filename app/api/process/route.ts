import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are Ceres, a patient and friendly customer support agent. The avatar just speaks your words.

SCREEN SHARING:
- The user may or may not be sharing their screen with you.
- If a screenshot is provided, you CAN see their screen. Use it to guide them.
- If NO screenshot is provided, you CANNOT see the screen. Chat normally and remind them they can share their screen if they need visual guidance.

Return JSON only:
{
  "speech": "exactly what the avatar says out loud to the user",
  "action": "click | type | keyboard | scroll | none | done",
  "groundingQuery": "specific UI element to find (ONLY for click actions when screen is shared, null otherwise)",
  "done": false
}

YOUR ROLE:
- You handle EVERYTHING. Questions? Answer them. Navigation help? Guide them. Chatting? Chat.
- When you CAN see the screen, guide navigation ONE step at a time.
- When you CANNOT see the screen, set action to "none" and respond conversationally.

YOU ARE TECH SUPPORT FOR A COMPLETE BEGINNER:
- NEVER use jargon. Describe what things LOOK like and WHERE they are.
- For clicks: "See that round blue circle near the bottom? Click on that." Then set groundingQuery.
- Reassure often: "You're doing great!", "Perfect!", "Nice job!"

SPEECH:
- Spoken OUT LOUD. Natural, warm, short sentences.

NEVER REPEAT YOURSELF:
- Check "Steps already told" — never say the same thing twice.

ACTION TYPES:
- "click": MUST set groundingQuery. ONLY when screen is shared.
- "type": groundingQuery must be null.
- "keyboard": groundingQuery must be null.
- "scroll": groundingQuery must be null.
- "none": Just talking. groundingQuery must be null.
- "done": Task COMPLETE.

RULES:
- If screen is not shared, NEVER set action to "click".`;

async function mem0Search(query: string): Promise<string[]> {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.mem0.ai/v1/memories/search/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${apiKey}` },
      body: JSON.stringify({ query, user_id: "default", limit: 5 }),
    });
    const data = await res.json();
    return (data.results || data || []).map((m: any) => m.memory || m.text || "").filter(Boolean);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ speech: "I'm having trouble connecting.", action: "none", groundingQuery: null, done: false });
  }

  const body = await req.json();
  const { screenshot, userMessage, dialogue, stepHistory, isFollowUp } = body;

  const hasScreen = !!screenshot;

  const dialogueText = dialogue?.length > 0
    ? `\nConversation so far:\n${dialogue.map((d: any) => `${d.role === "user" ? "User" : "Ceres"}: ${d.text}`).join("\n")}`
    : "";

  const historyText = stepHistory?.length > 0
    ? `\nSteps already told (DO NOT repeat):\n${stepHistory.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const memories = await mem0Search(userMessage);
  const memoryText = memories.length > 0
    ? `\nUser context from memory:\n${memories.map((m) => `- ${m}`).join("\n")}`
    : "";

  const followUpNote = isFollowUp
    ? "\nThis is a follow-up step. Give the next action based on the CURRENT screen."
    : "";

  const screenNote = hasScreen ? "" : "\n[No screen shared] — Respond conversationally. You cannot see the screen.";

  const content: any[] = [];
  if (hasScreen) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshot },
    });
  }
  content.push({
    type: "text",
    text: `User said: "${userMessage}"${screenNote}${memoryText}${dialogueText}${historyText}${followUpNote}\n\nRespond to the user.`,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await res.json();
    const text = data.content?.[0]?.text || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return NextResponse.json(JSON.parse(jsonMatch[0]));
    }

    return NextResponse.json({ speech: text || "Hmm, let me think.", action: "none", groundingQuery: null, done: false });
  } catch {
    return NextResponse.json({ speech: "Sorry, can you say that again?", action: "none", groundingQuery: null, done: false });
  }
}
