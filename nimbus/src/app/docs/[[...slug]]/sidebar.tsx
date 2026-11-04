"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { DocGroup } from "@/lib/data";

export function DocsSidebar({ groups }: { groups: DocGroup[] }) {
  const path = usePathname();
  const [router, setRouter] = useState("app");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto py-8 lg:block">
      <label className="mb-6 block">
        <span className="sr-only">Router</span>
        <select value={router} onChange={(e) => setRouter(e.target.value)} className="w-full rounded-md border border-line bg-bg-soft px-2 py-1.5 text-sm">
          <option value="app">Using App Router</option>
          <option value="pages">Using Pages Router</option>
        </select>
      </label>
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <button
            onClick={() => setClosed((c) => ({ ...c, [g.title]: !c[g.title] }))}
            aria-expanded={!closed[g.title]}
            className="flex w-full items-center justify-between py-1 text-sm font-semibold"
          >
            {g.title}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition ${closed[g.title] ? "-rotate-90" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {!closed[g.title] && (
            <ul className="mt-1 border-l border-line">
              {g.items.map((it) => {
                const href = `/docs${it.slug ? "/" + it.slug : ""}`;
                const active = path === href;
                return (
                  <li key={href}>
                    <Link href={href} className={`-ml-px block border-l py-1.5 pl-3 text-sm ${active ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}>{it.title}</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </aside>
  );
}
