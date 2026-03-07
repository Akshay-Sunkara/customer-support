import { NextResponse } from "next/server";

const GROUNDING_SYSTEM_PROMPT = `You are a UI grounding engine. Identify EXACTLY ONE clickable element and return its PIXEL COORDINATES.

RULES:
1. Each clickable element on screen is a unique INSTANCE
2. If multiple similar elements exist, use position/context to disambiguate
3. ALWAYS return pixel coordinates as [x, y] integers (normalized 0-999 range)

OUTPUT FORMAT (JSON ONLY):
{
  "status": "success",
  "coordinate": [x, y],
  "element": "<short description>"
}

Return JSON ONLY.`;

export async function POST(req: Request) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing RUNPOD_API_KEY" }, { status: 500 });
  }

  const { screenshot, query, imgW, imgH } = await req.json();

  const userPrompt = query
    ? `Find and return coordinates for: ${query}`
    : `Find the most prominent interactive UI element on screen.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
