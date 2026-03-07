import { NextResponse } from "next/server";

const GROUNDING_SYSTEM_PROMPT = `You are a precise UI element locator. Find EXACTLY ONE element on the screen and return its PIXEL COORDINATES.

RULES:
1. Scan the ENTIRE screen carefully — top to bottom, left to right — before answering
2. Use visual cues: icons, text labels, colors, position relative to other elements
3. The element may be anywhere: toolbars, sidebars, tab bars, bookmarks bars, menus, content areas, headers, footers
4. Be PRECISE — target the CENTER of the element, not its edges
5. Each element is a unique instance — use surrounding context to disambiguate similar elements
6. Coordinates must be integers in normalized 0-999 range (0=top-left, 999=bottom-right)

OUTPUT FORMAT (JSON ONLY):
{
  "status": "success",
  "coordinate": [x, y],
  "element": "<short description>"
}

Return JSON ONLY. No explanation.`;

export async function POST(req: Request) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing RUNPOD_API_KEY" }, { status: 500 });
  }

  const { screenshot, query, imgW, imgH } = await req.json();

  const userPrompt = query
    ? `Look at the entire screenshot carefully. Find this element: ${query}. Return its exact center coordinates.`
    : `Find the most prominent interactive UI element on screen.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch("https://api.runpod.ai/v2/qana3hao7olp53/runsync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          openai_route: "/v1/chat/completions",
          openai_input: {
            model: "tongyi-mai/mai-ui-8b",
            messages: [
              { role: "system", content: [{ type: "text", text: GROUNDING_SYSTEM_PROMPT }] },
              {
                role: "user",
                content: [
                  { type: "text", text: userPrompt },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
                ],
              },
            ],
            max_tokens: 256,
            temperature: 0.0,
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await res.json();

    let text = "";
    try {
      const output = data.output;
      if (Array.isArray(output) && output[0]?.choices?.[0]?.message?.content) {
        text = output[0].choices[0].message.content.trim();
      } else if (typeof output === "string") {
        text = output.trim();
      }
    } catch {}

    if (!text) return NextResponse.json({});

    const coordPattern = /"coordinate":\s*\[(\d+),\s*(\d+)\]/;
    const coordMatch = text.match(coordPattern);

    if (coordMatch) {
      const rawX = parseInt(coordMatch[1]);
      const rawY = parseInt(coordMatch[2]);
      const w = imgW || 1920;
      const h = imgH || 1080;
      const x = Math.round((rawX / 999) * w);
      const y = Math.round((rawY / 999) * h);

      const elemPattern = /"element":\s*"([^"]+)"/;
      const elemMatch = text.match(elemPattern);
      const label = elemMatch ? elemMatch[1].slice(0, 60) : query || "Click here";

      return NextResponse.json({ x, y, label, imgW: w, imgH: h });
    }

    const genericPattern = /\[(\d+),\s*(\d+)\]/;
    const genericMatch = text.match(genericPattern);
    if (genericMatch) {
      const x = Math.round((parseInt(genericMatch[1]) / 999) * (imgW || 1920));
      const y = Math.round((parseInt(genericMatch[2]) / 999) * (imgH || 1080));
      return NextResponse.json({ x, y, label: query || "Click here", imgW: imgW || 1920, imgH: imgH || 1080 });
    }

    return NextResponse.json({});
  } catch {
    return NextResponse.json({});
  }
}
