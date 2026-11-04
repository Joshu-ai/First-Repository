"use client";
import { brand } from "@/lib/brand";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const cols = [
  { title: "Products", links: [["Templates", "/store"], ["Website services", "/services"], ["Course", "/learn"], ["Hosting", "/hosting"]] },
  { title: "Resources", links: [["Docs", "/docs"], ["Blog", "/blog"], ["Showcase", "/showcase"]] },
  { title: "Account", links: [["Log in", "/login"], ["Sign up", "/signup"], ["Dashboard", "/dashboard"]] },
  { title: "Legal", links: [["Privacy Policy", "#"], ["Terms", "#"]] },
];

export function Footer() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const d = await r.json();
    setStatus({ ok: d.ok, text: d.ok ? d.message : d.error });
    if (d.ok) setEmail("");
    setBusy(false);
  }
  return (
    <footer className="border-t border-line bg-bg-soft">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-6 md:px-6">
        <div className="md:col-span-1"><Logo /></div>
        {cols.map((c) => (
          <div key={c.title}>
            <h3 className="mb-3 text-sm font-medium">{c.title}</h3>
            <ul className="space-y-2">
              {c.links.map(([l, h]) => (<li key={l}><Link href={h} className="text-sm text-muted hover:text-fg">{l}</Link></li>))}
            </ul>
          </div>
        ))}
        <div>
          <h3 className="mb-3 text-sm font-medium">Subscribe to our newsletter</h3>
          <p className="mb-3 text-sm text-muted">Release notes and updates, once a month.</p>
          <form onSubmit={subscribe} className="flex gap-2">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@domain.com" aria-label="Email" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-sm outline-none focus:ring-2 focus:ring-accent" />
            <button disabled={busy} className="h-9 rounded-md border border-line bg-bg px-3 text-sm hover:bg-bg-soft disabled:opacity-50">Subscribe</button>
          </form>
          {status && <p role="status" className={`mt-2 text-xs ${status.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{status.text}</p>}
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-line px-4 py-6 text-xs text-muted md:px-6">
        <span>© {new Date().getFullYear()} {brand.name}. All rights reserved.</span>
        <ThemeToggle />
      </div>
    </footer>
  );
}
