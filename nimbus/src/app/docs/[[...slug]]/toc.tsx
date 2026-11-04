"use client";
import { useEffect, useState } from "react";

export function Toc({ items }: { items: { id: string; heading: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) if (e.isIntersecting) setActive(e.target.id); },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    items.forEach((i) => { const el = document.getElementById(i.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [items]);
  return (
    <aside className="sticky top-16 hidden h-fit w-52 shrink-0 py-10 xl:block">
      <p className="mb-3 text-sm font-medium">On this page</p>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id}><a href={`#${i.id}`} className={`text-sm ${active === i.id ? "text-fg" : "text-muted hover:text-fg"}`}>{i.heading}</a></li>
        ))}
      </ul>
      <a href="#" className="mt-6 inline-block text-xs text-muted hover:text-fg">Scroll to top ↑</a>
    </aside>
  );
}
