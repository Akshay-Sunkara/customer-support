import { NextRequest, NextResponse } from "next/server";

const CUA_SERVER = process.env.CUA_SERVER_URL || "http://localhost:8420";

/** POST /api/cua/stop — Stop a running CUA agent */
export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const res = await fetch(`${CUA_SERVER}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[cua/stop]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "CUA server unavailable" },
      { status: 500 },
    );
  }
}
