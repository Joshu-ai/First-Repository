import { NextResponse } from "next/server";
import { searchIndex } from "@/lib/data";

const index = searchIndex();

export function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return NextResponse.json({ results: [] });
  const terms = q.split(/\s+/);
  const results = index
    .map((h) => {
      const t = h.title.toLowerCase();
      if (!terms.every((w) => t.includes(w))) return null;
      return { ...h, score: (t.startsWith(q) ? 2 : 0) + (h.title.includes("›") ? 0 : 1) };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((h) => ({ title: h.title, href: h.href, section: h.section }));
  return NextResponse.json({ results });
}
