import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/cua/guide
 * Receives a screenshot from the N22 Support native app (guide mode),
 * sends it to Claude for analysis, then uses MAI-UI grounding to get
 * precise coordinates for the annotation overlay.
 */

const MAI_UI_ENDPOINT =
  process.env.MAI_UI_ENDPOINT ??
  "https://ecvmzs3awqlmmatt.us-east-1.aws.endpoints.huggingface.cloud";
const HF_TOKEN = process.env.HF_TOKEN ?? "";

export async function POST(req: NextRequest) {
  try {
    const { sessionId, screenshot } = await req.json();

    if (!sessionId || !screenshot) {
      return NextResponse.json({ error: "Missing sessionId or screenshot" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured" }, { status: 500 });
    }

    // Step 1: Ask Claude what the user should do next based on the screenshot
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: `You are a support agent guiding a customer via screen annotations. Look at their screen and determine what element they should interact with next to accomplish their task. Respond in JSON: {"element":"visual description of the UI element to point at","speech":"one sentence instruction to speak aloud","done":false}. Keep speech to 1 sentence. Set done:true when task is complete.`,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot } },
              { type: "text", text: "What should the user click or interact with next? Look at the screen and guide them." },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });

    const claudeData = await claudeRes.json();
    let element = "";
    let speech = "";
    let done = false;

    for (const block of claudeData.content || []) {
      if (block.type === "text") {
        const m = block.text.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            element = parsed.element || "";
            speech = parsed.speech || "";
            done = parsed.done || false;
          } catch {}
        }
        if (!speech) speech = block.text.replace(/\{[\s\S]*?\}/g, "").trim();
      }
    }

    if (!element) {
      return NextResponse.json({ speech, annotation: null, done });
    }

    // Step 2: Use MAI-UI grounding to find the exact coordinates of the element
    const annotation = await groundElement(screenshot, element);

    return NextResponse.json({
      speech,
      annotation: annotation || null,
      done,
    });
  } catch (err) {
    console.error("[cua/guide]", err);
    return NextResponse.json({ error: "Guide analysis failed" }, { status: 500 });
  }
}

async function groundElement(screenshot: string, query: string) {
  const dataUrl = `data:image/jpeg;base64,${screenshot}`;
  const prompt = `In this image, locate and output the coordinates of: ${query}. Output the position as a point in the format <point>x y</point> where x and y are coordinates on a 1000x1000 grid.`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (HF_TOKEN) headers["Authorization"] = `Bearer ${HF_TOKEN}`;

  try {
    const res = await fetch(`${MAI_UI_ENDPOINT}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "Tongyi-MAI/MAI-UI-8B",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: prompt },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0.0,
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";

    // Parse <point>x y</point>
    const pointMatch = content.match(/<point>\s*\(?\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*\)?\s*<\/point>/i);
    if (pointMatch) {
      let x = parseFloat(pointMatch[1]);
      let y = parseFloat(pointMatch[2]);
      if (x > 1 || y > 1) { x /= 1000; y /= 1000; }
      return { cx: Math.max(0, Math.min(1, x)), cy: Math.max(0, Math.min(1, y)), label: query };
    }

    // Fallback: box center
    const boxMatch = content.match(/<box>\s*\(?\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*\)?\s*<\/box>/i);
    if (boxMatch) {
      let x = (parseFloat(boxMatch[1]) + parseFloat(boxMatch[3])) / 2;
      let y = (parseFloat(boxMatch[2]) + parseFloat(boxMatch[4])) / 2;
      if (x > 1 || y > 1) { x /= 1000; y /= 1000; }
      return { cx: Math.max(0, Math.min(1, x)), cy: Math.max(0, Math.min(1, y)), label: query };
    }

    return null;
  } catch {
    return null;
  }
}
