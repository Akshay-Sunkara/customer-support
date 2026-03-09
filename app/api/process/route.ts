import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are Ceres, a patient and friendly customer support agent. The avatar speaks your words.

VISIBILITY:
- Screenshot provided = you CAN see their screen.
- Camera frame provided = you CAN see what they're physically showing you (devices, hardware, documents, objects).
- Neither = you CANNOT see anything. Chat normally.

RESPONSE FORMAT — ALWAYS return valid JSON:
{
  "speech": "your full spoken response — REQUIRED, never empty",
  "action": "none | done",
  "done": false
}

SPEECH RULES:
- "speech" must ALWAYS be a full, helpful response. NEVER empty or vague.
- Even when calling highlight_element, your JSON speech must contain complete instructions.
- NEVER say "let me look" or "one moment" — describe what you see immediately.
- Natural, warm, short sentences. Spoken out loud.
- Reassure: "You're doing great!", "Perfect!", "Nice job!"
- No jargon. Describe what things LOOK like and WHERE they are.
- NEVER repeat or echo back what the user just said. Do NOT start with "You want to..." or "You're asking about..." or restate their question. Jump straight to your answer or guidance.

HIGHLIGHTING — THIS IS YOUR PRIMARY TOOL. USE IT AGGRESSIVELY:
You MUST call highlight_element whenever ANY of these are true:
- User mentions ANY object, element, button, icon, link, port, switch, or component visible on screen or camera
- User asks to find, click, locate, identify, point to, show, or pinpoint ANYTHING
- User asks "where is", "which one", "show me", "find", "what is this", "point to"
- User refers to ANY physical part on a device (button, port, connector, LED, switch, label, cable)
- User asks about ANY visible item — even if they're just curious, not asking for help
- You are describing something you can see — ALWAYS highlight it so they can see exactly what you mean

When calling the tool:
- SCREEN: describe the UI element precisely (e.g. "the blue Submit button in the bottom-right", "the Settings gear icon in the top toolbar")
- CAMERA: describe the physical element precisely (e.g. "the power button on the top edge of the device", "the USB-C port on the left side", "the water bottle with blue cap")
- Be as specific as possible. Include color, shape, position, and surrounding context.

If you CANNOT find the element, say so honestly.
Your speech must ALWAYS include full instructions — the highlight is a visual aid, not a replacement.

YOUR ROLE:
- Handle everything: questions, navigation, identification, troubleshooting, chatting.
- Guide ONE step at a time when helping with tasks.
- Check "Steps already told" — never repeat yourself.

RULES:
- No screen/camera shared = NEVER use highlight_element.
- ALWAYS return JSON with non-empty "speech".
- Set action to "done" when task is complete.
- End responses by asking if they need anything else.

KNOWN DEVICES:
- Honeywell fan: If you see a Honeywell fan and the user wants to turn it off, follow these steps IN ORDER:
  1. FIRST: Tell them to look at the TOP of the fan — there's a knob up there to turn it off. Do NOT call highlight_element yet. Just guide them verbally.
  2. SECOND: Only AFTER the user shows you the knob (you can see it clearly in the camera — it will be a close-up of the top of the fan with the knob visible), THEN call highlight_element to annotate the knob and tell them to twist or press it.
  Never skip step 1. Never annotate on the first message when you just see the whole fan.`;

const HIGHLIGHT_TOOL = {
  name: "highlight_element",
  description: "Visually highlight and annotate a specific element for the user. Works on BOTH screen shares (UI elements like buttons, links, icons, menus) AND camera feeds (physical objects like buttons, ports, cables, devices, bottles, documents). ALWAYS use this tool when you can see something the user is asking about. The annotation will appear as a visual overlay in the user's chat.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "Precise description of the element to find. Include appearance, color, shape, and position. Screen examples: 'the blue Submit button in the bottom-right corner', 'the Chrome tab labeled Gmail'. Camera examples: 'the power button on the top edge of the device', 'the USB-C port on the left side', 'the clear water bottle with blue cap', 'the red LED indicator near the battery'.",
      },
      action_label: {
        type: "string" as const,
        description: "Short instruction for the user (shown as tooltip on the annotation). Screen examples: 'Click here', 'Tap this button', 'Select this option'. Camera examples: 'Press this button', 'Plug in here', 'This is your water bottle'. Keep under 8 words.",
      },
      source: {
        type: "string" as const,
        enum: ["screen", "camera"],
        description: "Which input to highlight on. Use 'screen' for UI elements visible in the screen share. Use 'camera' for physical objects visible in the camera feed.",
      },
    },
    required: ["query", "action_label", "source"],
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

  const screenNote = hasScreen ? "" : "\n[No screen shared] — You cannot see the screen.";
  const cameraNote = hasCamera
    ? hasScreen
      ? "\n[Camera AND screen shared] — You have TWO images: the first is the screen share, the second is the camera feed. When using highlight_element, set source to 'screen' for UI elements or 'camera' for physical objects."
      : "\n[Camera shared] — The user is sharing their camera. You can see what they're showing you. Use source='camera' when highlighting."
    : "";
  const nameNote = userName && userName !== "there" ? `\nThe user's name is "${userName}". Use it naturally (not every message).` : "";

  const content: any[] = [];
  if (hasScreen && hasCamera) {
    content.push({ type: "text", text: "[IMAGE 1: Screen share]" });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshot },
    });
    content.push({ type: "text", text: "[IMAGE 2: Camera feed]" });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: cameraFrame },
    });
  } else if (hasScreen) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: screenshot },
    });
  } else if (hasCamera) {
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
        ...((hasScreen || hasCamera) ? { tools: [HIGHLIGHT_TOOL] } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await res.json();
    console.log("[process] Claude response stop_reason:", data.stop_reason, "hasScreen:", hasScreen, "hasCamera:", hasCamera);
    console.log("[process] Content blocks:", data.content?.map((b: any) => b.type).join(", "));

    let speech = "";
    let action = "none";
    let done = false;
    let highlightQuery: string | null = null;
    let actionLabel: string | null = null;
    let highlightSource: "screen" | "camera" | null = null;

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
        actionLabel = block.input?.action_label || null;
        highlightSource = block.input?.source || null;
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
                  content: "Element highlighted successfully. The user can see the annotation overlay now. Give your full spoken response — describe where the element is, what it looks like, and what to do with it.",
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
      speech = "I can see it! I've highlighted it for you. Let me know if you need anything else!";
    }

    console.log("[process] Result — highlightQuery:", highlightQuery, "actionLabel:", actionLabel, "speech:", speech?.slice(0, 80));

    // Infer source if Claude didn't specify: default based on what's available
    if (highlightQuery && !highlightSource) {
      highlightSource = hasCamera && !hasScreen ? "camera" : "screen";
    }

    return NextResponse.json({
      speech: speech || "I can see your screen! Let me help you with that.",
      action,
      done,
      highlightQuery,
      actionLabel,
      highlightSource,
    });
  } catch (e) {
    console.error("[process] Error:", e);
    return NextResponse.json({ speech: "Sorry, can you say that again?", action: "none", done: false, highlightQuery: null });
  }
}
