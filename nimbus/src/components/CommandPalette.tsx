"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Hit = { title: string; href: string; section: string };
const Ctx = createContext<() => void>(() => {});
export const useOpenSearch = () => useContext(Ctx);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSearch = useCallback(() => setOpen(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Ctx.Provider value={openSearch}>
      {children}
      {open && <Palette onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => { setHits(d.results); setActive(0); setLoading(false); })
        .catch(() => {});
    }, 120);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const go = (h: Hit) => { onClose(); router.push(h.href); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-bg shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && hits[active]) go(hits[active]);
            }}
            placeholder="Search documentation..."
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 text-xs text-muted">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {q && !loading && hits.length === 0 && <li className="p-6 text-center text-sm text-muted">No results for &ldquo;{q}&rdquo;</li>}
          {!q && <li className="p-6 text-center text-sm text-muted">Type to search docs, blog posts and pages.</li>}
          {hits.map((h, i) => (
            <li key={h.href} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${i === active ? "bg-bg-soft ring-1 ring-line" : ""}`}
              >
                <span>{h.title}</span>
                <span className="text-xs text-muted">{h.section}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SearchButton({ className = "" }: { className?: string }) {
  const open = useOpenSearch();
  return (
    <button onClick={open} className={`flex h-8 items-center gap-2 rounded-md border border-line bg-bg-soft px-3 text-sm text-muted hover:text-fg ${className}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span className="flex-1 text-left">Search docs...</span>
      <kbd className="rounded border border-line bg-bg px-1 text-xs">⌘K</kbd>
    </button>
  );
}
