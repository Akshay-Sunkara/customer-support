import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are Ceres, a patient and friendly customer support agent. The avatar just speaks your words.

SCREEN SHARING:
- If a screenshot is provided, you CAN see their screen.
- If NO screenshot is provided, you CANNOT see the screen. Chat normally and remind them they can share their screen.

CAMERA SHARING:
- If a camera frame is provided, you CAN see what the user is showing you through their camera.
- Describe what you see in the camera feed when relevant.
- The camera is useful for showing physical items, documents, or anything the user wants help identifying.

RESPONSE FORMAT — you MUST ALWAYS return valid JSON:
{
  "speech": "exactly what the avatar says out loud to the user — REQUIRED, never empty",
  "action": "none | done",
  "done": false
}

CRITICAL — READ THIS CAREFULLY:
- The "speech" field must ALWAYS contain your full, complete spoken response. NEVER leave it empty or short.
- Even when using the highlight_element tool, your JSON MUST come FIRST with a full helpful speech.
- Your speech should be a COMPLETE answer — describe where the element is, what it looks like, and what to do. Example: "I can see Vercel right there in your bookmarks bar at the top! It's the little triangle icon. Go ahead and click on it! Check the steps section to see exactly where it is."
- NEVER say vague things like "let me look" or "one moment" — actually LOOK at the screenshot and describe what you see.

YOUR ROLE:
- You handle EVERYTHING. Questions? Answer them. Navigation help? Guide them. Chatting? Chat.
- When you CAN see the screen, guide navigation ONE step at a time.
- When you CANNOT see the screen, set action to "none" and respond conversationally.

YOU ARE TECH SUPPORT FOR A COMPLETE BEGINNER:
- NEVER use jargon. Describe what things LOOK like and WHERE they are.
- Reassure often: "You're doing great!", "Perfect!", "Nice job!"

HIGHLIGHTING — MANDATORY WHEN SCREEN IS SHARED:
- When the user's screen is visible and they ask about finding, clicking, or locating ANYTHING on screen, you MUST:
  1. Look at the screenshot carefully for the element
  2. Call the highlight_element tool with a precise description of the element you see
  3. Include helpful speech in your JSON with FULL instructions: describe where the element is, what it looks like, and exactly what to click. Then tell the user: "Check the steps section to see exactly where to click!"
- ALWAYS use the tool when the user asks "where is X", "how do I click X", "find X", "show me X", etc.
- Be specific in your query: "the LinkedIn tab in the browser tab bar", "the Vercel bookmark in the bookmarks bar", "the search bar at the top".
- If you CANNOT find the element on screen, say so honestly — do NOT skip the tool silently.
- Your speech must ALWAYS include the actual instructions (what to click, where it is, what it looks like) — the highlight is just a visual aid, NOT a replacement for your spoken guidance.

SPEECH:
- Spoken OUT LOUD. Natural, warm, short sentences.

NEVER REPEAT YOURSELF:
- Check "Steps already told" — never say the same thing twice.

RULES:
- If screen is not shared, NEVER use the highlight_element tool.
- ALWAYS return JSON with a non-empty "speech" field.
- Set action to "done" when a task is complete.

CONVERSATION FLOW:
- ALWAYS end your response by asking if the user needs anything else.
- If you are guiding the user through a multi-step process, tell them to let you know when they have completed the current step or if they have any questions.
- Examples: "Let me know when you've done that!", "Anything else I can help with?", "Tell me when you're ready for the next step!"`;

const HIGHLIGHT_TOOL = {
  name: "highlight_element",
  description: "Visually highlight a specific UI element on the user's shared screen. Draws a bright annotation circle and label on their screen capture, which appears in the chat. Use this whenever you refer to or guide the user toward a specific button, link, icon, menu, text field, or any other UI element.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "A clear, specific description of the UI element to find and highlight. Be precise about appearance and location. Examples: 'the blue Submit button', 'the gear icon in the top-right corner', 'the Settings option in the dropdown menu'",
      },
    },
    required: ["query"],
  },
};

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
  const { screenshot, cameraFrame, userMessage, userName, dialogue, stepHistory, isFollowUp } = body;

  const hasScreen = !!screenshot;
  const hasCamera = !!cameraFrame;

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
  const cameraNote = hasCamera ? "\n[Camera shared] — The user is sharing their camera. You can see what they're showing you." : "";
  const nameNote = userName && userName !== "there" ? `\nThe user's name is "${userName}". Use it naturally (not every message).` : "";

  const content: any[] = [];
  if (hasScreen) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshot },
    });
  }
  if (hasCamera) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: cameraFrame },
    });
  }
  content.push({
    type: "text",
    text: `User said: "${userMessage}"${screenNote}${cameraNote}${nameNote}${memoryText}${dialogueText}${historyText}${followUpNote}\n\nRespond to the user.`,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        ...(hasScreen ? { tools: [HIGHLIGHT_TOOL] } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await res.json();
    console.log("[process] Claude response stop_reason:", data.stop_reason);

    let speech = "";
    let action = "none";
    let done = false;
    let highlightQuery: string | null = null;

    // Check if Claude called the highlight tool
    let toolUseBlock: any = null;
    for (const block of data.content || []) {
      if (block.type === "text") {
        const jsonMatch = block.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.speech) speech = parsed.speech;
            if (parsed.action) action = parsed.action;
            if (parsed.done) done = parsed.done;
          } catch {}
        }
        if (!speech) {
          const cleaned = block.text.replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*?\}/g, "").trim();
          if (cleaned) speech = cleaned;
        }
      } else if (block.type === "tool_use" && block.name === "highlight_element") {
        highlightQuery = block.input?.query || null;
        toolUseBlock = block;
      }
    }

    // If Claude called the tool, send the tool result back to get a proper spoken response
    if (toolUseBlock && data.stop_reason === "tool_use") {
      try {
        const followUpRes = await fetch("https://api.anthropic.com/v1/messages", {
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
            messages: [
              { role: "user", content },
              { role: "assistant", content: data.content },
              {
                role: "user",
                content: [{
                  type: "tool_result",
                  tool_use_id: toolUseBlock.id,
                  content: "Element highlighted successfully. The user can now see it in their steps panel. Now give your full spoken response with instructions — describe where the element is, what it looks like, and tell them to check the steps section.",
                }],
              },
            ],
          }),
        });
        const followUpData = await followUpRes.json();
        console.log("[process] Follow-up response:", JSON.stringify(followUpData.content?.[0]?.text?.slice(0, 200)));

        for (const block of followUpData.content || []) {
          if (block.type === "text") {
            const jsonMatch = block.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.speech) speech = parsed.speech;
                if (parsed.action) action = parsed.action || action;
                if (parsed.done) done = parsed.done;
              } catch {}
            }
            if (!speech) {
              const cleaned = block.text.replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*?\}/g, "").trim();
              if (cleaned) speech = cleaned;
            }
          }
        }
      } catch (e) {
        console.error("[process] Follow-up failed:", e);
      }
    }

    // Final fallback
    if (!speech && highlightQuery) {
      speech = "I can see it on your screen! Check the steps section to see exactly where to click. Let me know if you need anything else!";
    }

    return NextResponse.json({
      speech: speech || "I can see your screen! Let me help you with that.",
      action,
      done,
      highlightQuery,
    });
  } catch (e) {
    console.error("[process] Error:", e);
    return NextResponse.json({ speech: "Sorry, can you say that again?", action: "none", done: false, highlightQuery: null });
  }
}
