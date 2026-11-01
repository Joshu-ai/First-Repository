import { NextResponse } from "next/server";

// Demo only: keeps sign-ups in memory for the life of the server process.
const subscribers = new Set<string>();

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  const already = subscribers.has(email);
  subscribers.add(email);
  return NextResponse.json({ ok: true, message: already ? "You're already subscribed." : "Thanks for subscribing!" });
}
