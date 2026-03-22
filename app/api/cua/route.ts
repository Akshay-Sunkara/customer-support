import { NextRequest, NextResponse } from "next/server";

const CUA_SERVER = process.env.CUA_SERVER_URL || "http://localhost:8420";

/** POST /api/cua — Start a CUA agent or get status */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sessionId, deviceId, password, task } = body;

    if (action === "start") {
      const res = await fetch(`${CUA_SERVER}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, deviceId, password, task }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === "status") {
      const res = await fetch(`${CUA_SERVER}/status/${sessionId}`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === "actions") {
      const res = await fetch(`${CUA_SERVER}/actions/${sessionId}`);
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[cua]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "CUA server unavailable" },
      { status: 500 },
    );
  }
}
