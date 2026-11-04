"use client";
import { useEffect, useState } from "react";
import { showcaseCategories, type ShowcaseItem } from "@/lib/data";

export function ShowcaseGrid() {
  const [cat, setCat] = useState<string>("All");
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);

  async function load(category: string, offset: number, replace: boolean) {
    setLoading(true);
    const r = await fetch(`/api/showcase?category=${encodeURIComponent(category)}&offset=${offset}&limit=8`);
    const d = await r.json();
    setItems((prev) => (replace ? d.items : [...prev, ...d.items]));
    setNext(d.nextOffset);
    setLoading(false);
  }
  useEffect(() => { load(cat, 0, true); }, [cat]);

  return (
    <>
      <div role="tablist" className="mb-8 flex flex-wrap gap-2">
        {showcaseCategories.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={`rounded-full border px-3 py-1 text-sm ${cat === c ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg"}`}>{c}</button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((s) => (
          <a key={s.id} href={s.url} className="group overflow-hidden rounded-lg border border-line hover:border-muted">
            <div className="aspect-video" style={{ background: `linear-gradient(135deg, hsl(${s.hue} 70% 55% / .35), hsl(${(s.hue + 60) % 360} 70% 40% / .15))` }} />
            <div className="flex items-center justify-between p-4">
              <span className="font-medium">{s.name}</span>
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{s.category}</span>
            </div>
          </a>
        ))}
      </div>
      {next !== null && (
        <div className="mt-10 text-center">
          <button disabled={loading} onClick={() => load(cat, next, false)} className="h-10 rounded-md border border-line px-6 text-sm hover:bg-bg-soft disabled:opacity-50">{loading ? "Loading..." : "Load More"}</button>
        </div>
      )}
    </>
  );
}
