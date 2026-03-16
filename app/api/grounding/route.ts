import { NextResponse } from "next/server";

/**
 * MAI-UI-8B grounding — matches agent-dashboard/src/lib/mai-ui.ts exactly.
 * Calls the hosted HuggingFace endpoint to locate UI/physical elements.
 */

const MAI_UI_ENDPOINT =
  process.env.MAI_UI_ENDPOINT ??
  "https://ecvmzs3awqlmmatt.us-east-1.aws.endpoints.huggingface.cloud";

const HF_TOKEN = process.env.HF_TOKEN ?? "";

async function groundWithMAIUI(imageB64: string, query: string) {
  const dataUrl = `data:image/jpeg;base64,${imageB64}`;
  const groundingPrompt = `In this image, locate and output the coordinates of: ${query}. Output the position as a point in the format <point>x y</point> where x and y are coordinates on a 1000x1000 grid.`;

  const body = {
    model: "Tongyi-MAI/MAI-UI-8B",
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: groundingPrompt },
        ],
      },
    ],
    max_tokens: 512,
    temperature: 0.0,
    top_p: 1.0,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (HF_TOKEN) {
    headers["Authorization"] = `Bearer ${HF_TOKEN}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${MAI_UI_ENDPOINT}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[mai-ui] API error ${res.status}: ${errText}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    console.log(`[mai-ui] Raw response: ${content}`);

    return parseGroundingResponse(content, query);
  } catch (e) {
    clearTimeout(timeout);
    console.error("[mai-ui] Failed:", e);
    return null;
  }
}

/**
 * Parse MAI-UI-8B response — supports all coordinate formats:
 *   <point>x y</point>, <box>x1 y1 x2 y2</box>, (x, y), [x, y], bare numbers
 * Normalizes to 0-1 range (MAI-UI uses 1000x1000 grid).
 */
function parseGroundingResponse(text: string, query: string) {
  console.log(`[mai-ui] Parsing (${text.length} chars): "${text.slice(0, 200)}"`);

  // <point>x y</point>
  const pointMatch = text.match(/<point>\s*\(?\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*\)?\s*<\/point>/i);
  if (pointMatch) {
    console.log(`[mai-ui] Matched <point>: ${pointMatch[1]}, ${pointMatch[2]}`);
    return normalize(parseFloat(pointMatch[1]), parseFloat(pointMatch[2]), query);
  }

  // <box>x1 y1 x2 y2</box> — use center
  const boxMatch = text.match(/<box>\s*\(?\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*\)?\s*<\/box>/i);
  if (boxMatch) {
    const x1 = parseFloat(boxMatch[1]), y1 = parseFloat(boxMatch[2]);
    const x2 = parseFloat(boxMatch[3]), y2 = parseFloat(boxMatch[4]);
    console.log(`[mai-ui] Matched <box>: (${x1},${y1})-(${x2},${y2})`);
    return normalize((x1 + x2) / 2, (y1 + y2) / 2, query);
  }

  // click(x, y) or tap(x, y)
  const clickMatch = text.match(/(?:click|tap|point)\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (clickMatch) {
    return normalize(parseFloat(clickMatch[1]), parseFloat(clickMatch[2]), query);
  }

  // (x, y) or [x, y]
  const tupleMatch = text.match(/[\[(]\s*([\d.]+)\s*,\s*([\d.]+)\s*[\])]/);
  if (tupleMatch) {
    return normalize(parseFloat(tupleMatch[1]), parseFloat(tupleMatch[2]), query);
  }

  // x, y comma-separated
  const commaMatch = text.match(/([\d.]+)\s*,\s*([\d.]+)/);
  if (commaMatch) {
    const x = parseFloat(commaMatch[1]), y = parseFloat(commaMatch[2]);
    if (x > 0 && y > 0) return normalize(x, y, query);
  }

  // Bare numbers as last resort
  const numbers = text.match(/\b(\d+(?:\.\d+)?)\b/g);
  if (numbers && numbers.length >= 2) {
    const x = parseFloat(numbers[0]), y = parseFloat(numbers[1]);
    if (x > 0 && y > 0 && x <= 10000 && y <= 10000) {
      return normalize(x, y, query);
    }
  }

  console.error(`[mai-ui] Could not parse coordinates from: "${text.slice(0, 300)}"`);
  return null;
}

function normalize(x: number, y: number, query: string) {
  // If values > 1, assume 0-1000 scale (MAI-UI default)
  if (x > 1 || y > 1) { x = x / 1000; y = y / 1000; }
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  return { cx: x, cy: y, label: query || "Here" };
}

// --- Main route ---

export async function POST(req: Request) {
  const { screenshot, query, imgW, imgH, isCamera } = await req.json();
  console.log("[grounding] POST — isCamera:", isCamera, "query:", query, "imgW:", imgW, "imgH:", imgH);

  try {
    const result = await groundWithMAIUI(screenshot, query);
    console.log("[grounding] result:", result ? JSON.stringify(result).slice(0, 300) : "null");
    if (result) return NextResponse.json(result);
    return NextResponse.json({});
  } catch (e) {
    console.error("[grounding] error:", e);
    return NextResponse.json({});
  }
}
