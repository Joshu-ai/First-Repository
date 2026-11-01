import { NextResponse } from "next/server";
import { showcase } from "@/lib/data";

export function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const category = sp.get("category") ?? "All";
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(24, Math.max(1, Number(sp.get("limit") ?? 8) || 8));
  const filtered = category === "All" ? showcase : showcase.filter((s) => s.category === category);
  return NextResponse.json({
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
  });
}
