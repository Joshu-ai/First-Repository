"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { SearchButton } from "./CommandPalette";

const nav = [
  { href: "/docs", label: "Docs" },
  { href: "/store", label: "Templates" },
  { href: "/services", label: "Services" },
  { href: "/learn", label: "Course" },
  { href: "/hosting", label: "Hosting" },
  { href: "/blog", label: "Blog" },
];

export function Header({ account }: { account: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 md:px-6">
        <Link href="/" aria-label="Home"><Logo /></Link>
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 text-sm transition ${path.startsWith(n.href) ? "text-fg" : "text-muted hover:text-fg"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SearchButton className="hidden w-56 sm:flex" />
          {account}
          <button className="md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-3 md:hidden">
          <SearchButton className="mb-3 w-full" />
          {nav.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block py-2 text-sm">{n.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
