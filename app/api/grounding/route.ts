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

async function groundUI(screenshot: string, query: string, imgW: number, imgH: number) {
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

  // Parse normalized 0-999 coords
  const coordPattern = /"coordinate":\s*\[(\d+),\s*(\d+)\]/;
  const coordMatch = text.match(coordPattern);
  if (coordMatch) {
    const x = Math.round((parseInt(coordMatch[1]) / 999) * (imgW || 1920));
    const y = Math.round((parseInt(coordMatch[2]) / 999) * (imgH || 1080));
    const elemMatch = text.match(/"element":\s*"([^"]+)"/);
    return { x, y, label: elemMatch ? elemMatch[1].slice(0, 60) : query || "Here", imgW: imgW || 1920, imgH: imgH || 1080 };
  }

  const genericMatch = text.match(/\[(\d+),\s*(\d+)\]/);
  if (genericMatch) {
    const x = Math.round((parseInt(genericMatch[1]) / 999) * (imgW || 1920));
    const y = Math.round((parseInt(genericMatch[2]) / 999) * (imgH || 1080));
    return { x, y, label: query || "Here", imgW: imgW || 1920, imgH: imgH || 1080 };
  }

  return null;
}

// --- Camera grounding: Grounding DINO (primary) + Claude Vision (fallback) ---

async function groundCamera(imageB64: string, query: string, imgW: number, imgH: number) {
  // Try Grounding DINO first
  const dinoResult = await groundCameraDINO(imageB64, query, imgW, imgH);
  if (dinoResult) return dinoResult;

  // Fallback to Claude Vision
  return groundCameraVision(imageB64, query, imgW, imgH);
}

// --- Grounding DINO via HuggingFace Inference API ---

async function groundCameraDINO(imageB64: string, query: string, imgW: number, imgH: number) {
  const hfToken = process.env.HF_TOKEN;
  const model = "IDEA-Research/grounding-dino-tiny";
  const url = `https://api-inference.huggingface.co/models/${model}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: { image: `data:image/jpeg;base64,${imageB64}` },
        parameters: { candidate_labels: [query] },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[camera-grounding] DINO API error:", res.status, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    console.log("[camera-grounding] DINO response:", JSON.stringify(data).slice(0, 500));

    // HF returns array of { label, score, box: { xmin, ymin, xmax, ymax } }
    if (Array.isArray(data) && data.length > 0) {
      // Pick highest confidence detection
      const best = data.reduce((a: any, b: any) => (b.score > a.score ? b : a), data[0]);
      const box = best.box;
      const x = Math.round((box.xmin + box.xmax) / 2);
      const y = Math.round((box.ymin + box.ymax) / 2);
      console.log("[camera-grounding] DINO best:", best.label, "score:", best.score, "box:", box, "center:", x, y);
      return {
        x, y,
        box: { xmin: Math.round(box.xmin), ymin: Math.round(box.ymin), xmax: Math.round(box.xmax), ymax: Math.round(box.ymax) },
        label: best.label || query,
        imgW, imgH,
      };
    }

    console.log("[camera-grounding] DINO: no detections");
    return null;
  } catch (e) {
    clearTimeout(timeout);
    console.warn("[camera-grounding] DINO failed:", e);
    return null;
  }
}

// --- Claude Vision fallback for camera grounding ---

async function groundCameraVision(imageB64: string, query: string, imgW: number, imgH: number) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
            { type: "text", text: `You are a precise object locator. Find the EXACT bounding box and center of this element: "${query}"

Image: ${imgW}x${imgH}px. (0,0)=top-left. Front-facing camera (NOT mirrored): person's RIGHT side = LEFT of image (low x), person's LEFT side = RIGHT of image (high x).

Steps:
1. Find the element
2. Determine its bounding box edges (left x, right x, top y, bottom y)
3. Center = ((left+right)/2, (top+bottom)/2)

Return JSON ONLY:
{"x": <int>, "y": <int>, "box": {"xmin": <int>, "ymin": <int>, "xmax": <int>, "ymax": <int>}, "label": "<description>"}` },
          ],
        }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    console.log("[camera-grounding] Vision response:", text.slice(0, 400));

    // Try to parse box format
    const boxMatch = text.match(/"xmin"\s*:\s*(\d+)[\s\S]*?"ymin"\s*:\s*(\d+)[\s\S]*?"xmax"\s*:\s*(\d+)[\s\S]*?"ymax"\s*:\s*(\d+)/);
    const centerMatch = text.match(/"x"\s*:\s*(\d+)[\s\S]*?"y"\s*:\s*(\d+)/);
    const labelMatch = text.match(/"label"\s*:\s*"([^"]*)"/);

    if (centerMatch) {
      const result: any = {
        x: parseInt(centerMatch[1]),
        y: parseInt(centerMatch[2]),
        label: labelMatch ? labelMatch[1] : query,
        imgW, imgH,
      };
      if (boxMatch) {
        result.box = {
          xmin: parseInt(boxMatch[1]), ymin: parseInt(boxMatch[2]),
          xmax: parseInt(boxMatch[3]), ymax: parseInt(boxMatch[4]),
        };
      }
      return result;
    }
  } catch {
    clearTimeout(timeout);
  }
  return null;
}

// --- Main route ---

export async function POST(req: Request) {
  const { screenshot, query, imgW, imgH, isCamera } = await req.json();

  try {
    let result;
    if (isCamera) {
      result = await groundCamera(screenshot, query, imgW || 1280, imgH || 720);
    } else {
      result = await groundUI(screenshot, query, imgW || 1920, imgH || 1080);
    }

    if (result) return NextResponse.json(result);
    return NextResponse.json({});
  } catch {
    return NextResponse.json({});
  }
}
