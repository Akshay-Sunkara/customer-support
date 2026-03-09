import { NextResponse } from "next/server";

// --- UI grounding via RunPod (screen shares) ---

const UI_SYSTEM_PROMPT = `You are a precise UI element locator. Find EXACTLY ONE element on the screen and return its PIXEL COORDINATES.

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

async function groundUI(screenshot: string, query: string) {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) return null;

  const userPrompt = query
    ? `Look at the entire screenshot carefully. Find this element: ${query}. Return its exact center coordinates.`
    : `Find the most prominent interactive element.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  const res = await fetch("https://api.runpod.ai/v2/qana3hao7olp53/runsync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: {
        openai_route: "/v1/chat/completions",
        openai_input: {
          model: "tongyi-mai/mai-ui-8b",
          messages: [
            { role: "system", content: [{ type: "text", text: UI_SYSTEM_PROMPT }] },
            { role: "user", content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
            ]},
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

  if (!text) return null;

  // Parse normalized 0-999 coords → normalize to 0-1
  const coordPattern = /"coordinate":\s*\[(\d+),\s*(\d+)\]/;
  const coordMatch = text.match(coordPattern);
  if (coordMatch) {
    const cx = parseInt(coordMatch[1]) / 999;
    const cy = parseInt(coordMatch[2]) / 999;
    const elemMatch = text.match(/"element":\s*"([^"]+)"/);
    return { cx, cy, label: elemMatch ? elemMatch[1].slice(0, 60) : query || "Here" };
  }

  const genericMatch = text.match(/\[(\d+),\s*(\d+)\]/);
  if (genericMatch) {
    const cx = parseInt(genericMatch[1]) / 999;
    const cy = parseInt(genericMatch[2]) / 999;
    return { cx, cy, label: query || "Here" };
  }

  return null;
}

// --- Camera grounding via Grounding DINO (HuggingFace) ---

async function groundCamera(imageB64: string, query: string, imgW: number, imgH: number) {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) return null;

  // Grounding DINO expects simple label queries — extract the core noun
  const label = query.replace(/^(the|a|an)\s+/i, "").split(/[,.]/).map(s => s.trim()).filter(Boolean).join(". ") + ".";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("https://api-inference.huggingface.co/models/IDEA-Research/grounding-dino-base", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hfToken}`,
      },
      body: JSON.stringify({
        inputs: {
          image: `data:image/jpeg;base64,${imageB64}`,
          text: label,
        },
        parameters: {
          box_threshold: 0.25,
          text_threshold: 0.2,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[gdino] API error:", res.status, errText.slice(0, 300));

      // Fallback: try alternate request format
      return await groundCameraDinoAlt(imageB64, label, imgW, imgH);
    }

    const data = await res.json();
    console.log("[gdino] Response:", JSON.stringify(data).slice(0, 500));

    return parseDinoResponse(data, imgW, imgH, query);
  } catch (e) {
    clearTimeout(timeout);
    console.warn("[gdino] Failed:", e);
    return null;
  }
}

// Alternate request format for Grounding DINO
async function groundCameraDinoAlt(imageB64: string, label: string, imgW: number, imgH: number) {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    // Send raw image bytes with candidate_labels
    const imageBuffer = Buffer.from(imageB64, "base64");
    const res = await fetch("https://api-inference.huggingface.co/models/IDEA-Research/grounding-dino-base", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: `data:image/jpeg;base64,${imageB64}`,
        candidate_labels: [label.replace(/\./g, " ").trim()],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[gdino-alt] API error:", res.status, errText.slice(0, 300));
      return null;
    }

    const data = await res.json();
    console.log("[gdino-alt] Response:", JSON.stringify(data).slice(0, 500));

    return parseDinoResponse(data, imgW, imgH, label);
  } catch (e) {
    clearTimeout(timeout);
    console.warn("[gdino-alt] Failed:", e);
    return null;
  }
}

// Parse Grounding DINO response into normalized 0-1 coordinates
function parseDinoResponse(data: any, imgW: number, imgH: number, query: string) {
  // HF returns array of detections: [{box: {xmin, ymin, xmax, ymax}, score, label}]
  const items = Array.isArray(data) ? data : data?.results || data?.detections || [];

  if (!items.length) {
    console.warn("[gdino] No detections");
    return null;
  }

  // Pick highest confidence detection
  let best = items[0];
  for (const item of items) {
    if ((item.score || 0) > (best.score || 0)) best = item;
  }

  const box = best.box || best.bbox;
  if (!box) {
    console.warn("[gdino] No box in detection:", best);
    return null;
  }

  // box format: {xmin, ymin, xmax, ymax} in pixel coords
  const xmin = box.xmin ?? box.x1 ?? box[0] ?? 0;
  const ymin = box.ymin ?? box.y1 ?? box[1] ?? 0;
  const xmax = box.xmax ?? box.x2 ?? box[2] ?? 0;
  const ymax = box.ymax ?? box.y2 ?? box[3] ?? 0;

  const result = {
    cx: ((xmin + xmax) / 2) / imgW,
    cy: ((ymin + ymax) / 2) / imgH,
    box: {
      x: xmin / imgW,
      y: ymin / imgH,
      w: (xmax - xmin) / imgW,
      h: (ymax - ymin) / imgH,
    },
    label: best.label || query || "Here",
  };

  console.log("[gdino] Parsed:", {
    cx: result.cx.toFixed(3), cy: result.cy.toFixed(3),
    box: result.box, score: best.score, label: result.label,
  });

  return result;
}

// --- Main route ---

export async function POST(req: Request) {
  const { screenshot, query, imgW, imgH, isCamera } = await req.json();

  try {
    const result = isCamera
      ? await groundCamera(screenshot, query, imgW || 1280, imgH || 720)
      : await groundUI(screenshot, query);

    if (result) return NextResponse.json(result);
    return NextResponse.json({});
  } catch {
    return NextResponse.json({});
  }
}
