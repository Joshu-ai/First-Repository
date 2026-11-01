"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    let saved: Mode = "system";
    try { saved = (localStorage.getItem("theme") as Mode) || "system"; } catch {}
    setMode(saved);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if ((localStorage.getItem("theme") ?? "system") === "system") apply("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const set = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem("theme", m); } catch {}
    apply(m);
  };
  const opts: { m: Mode; label: string; icon: string }[] = [
    { m: "system", label: "System theme", icon: "M3 5h18v11H3zM8 20h8M12 16v4" },
    { m: "light", label: "Light theme", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
    { m: "dark", label: "Dark theme", icon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" },
  ];
  return (
    <div role="radiogroup" aria-label="Display theme" className="inline-flex rounded-full border border-line p-0.5">
      {opts.map((o) => (
        <button
          key={o.m}
          role="radio"
          aria-checked={mode === o.m}
          aria-label={o.label}
          onClick={() => set(o.m)}
          className={`grid h-7 w-7 place-items-center rounded-full transition ${mode === o.m ? "bg-bg-soft text-fg ring-1 ring-line" : "text-muted hover:text-fg"}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={o.icon} /></svg>
        </button>
      ))}
    </div>
  );
}

export const themeInitScript = `(function(){try{var m=localStorage.getItem('theme')||'system';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='dark'}})()`;
