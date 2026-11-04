import { brand } from "@/lib/brand";
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="M7 16V8l10 8V8" stroke="var(--bg)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-lg">{brand.name}</span>
    </span>
  );
}
