import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = process.env.TAVUS_API_KEY;
  const { conversationId } = await req.json();

  if (!apiKey || !conversationId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  await fetch(`https://tavusapi.com/v2/conversations/${conversationId}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
  });

  return NextResponse.json({ ok: true });
}
