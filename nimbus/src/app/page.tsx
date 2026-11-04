import Link from "next/link";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";

export const dynamic = "force-dynamic";

const offers = [
  { href: "/store", kind: "download" as const, title: "Templates & kits", text: "Production-ready Next.js starters. Pay once, get the full source code.", cta: "Shop templates", icon: "M4 4h16v16H4zM4 9h16M9 9v11" },
  { href: "/services", kind: "service" as const, title: "Done-for-you websites", text: "Fixed-price packages. We design, build and launch your site while you track progress.", cta: "See packages", icon: "M12 20l9-16H3z" },
  { href: "/learn", kind: "course" as const, title: "The Ship It course", text: "Learn to build and sell your own web app in 8 hands-on lessons.", cta: "Start learning", icon: "M4 19V5l8 4 8-4v14l-8 4z" },
  { href: "/hosting", kind: "hosting" as const, title: "Static hosting", text: "Upload your build, get a live URL in seconds. Simple monthly plans.", cta: "View plans", icon: "M3 15a4 4 0 0 0 4 4h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3 3 0 0 0 3 15z" },
];

export default function Home() {
  const from = (kind: (typeof offers)[number]["kind"]) => {
    const ps = q.products(kind);
    if (!ps.length) return null;
    const min = Math.min(...ps.map((p) => p.price_cents));
    return `from ${money(min)}${kind === "hosting" ? "/mo" : ""}`;
  };
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="mx-auto max-w-5xl px-4 pt-24 pb-20 text-center md:pt-32">
          <Link href="/builder" className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-bg-soft px-3 py-1 text-xs text-muted hover:text-fg">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> New: the Nimbus website builder. Build your site in minutes →
          </Link>
          <h1 className="text-5xl font-bold tracking-tighter md:text-7xl">Everything you need<br className="hidden sm:block" /> to launch on the web</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted md:text-xl">Start from a template, have us build it for you, learn to do it yourself, and host it with us. All in one place.</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/builder" className="flex h-11 items-center rounded-md bg-fg px-6 font-medium text-bg hover:opacity-90">Build a website</Link>
            <Link href="/services" className="flex h-11 items-center rounded-md border border-line px-6 font-medium hover:bg-bg-soft">Get a website built</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 md:px-6">
        <div className="grid overflow-hidden rounded-xl border border-line md:grid-cols-2">
          {offers.map((o, i) => (
            <Link key={o.href} href={o.href} className={`group flex flex-col p-8 hover:bg-bg-soft ${i < 2 ? "md:border-b" : ""} ${i % 2 === 0 ? "md:border-r" : ""} border-line max-md:[&:not(:last-child)]:border-b`}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" className="mb-4"><path d={o.icon} /></svg>
              <h2 className="text-xl font-semibold">{o.title}</h2>
              <p className="mt-2 flex-1 text-muted">{o.text}</p>
              <p className="mt-6 flex items-center justify-between text-sm"><span className="font-medium group-hover:underline">{o.cta} →</span><span className="text-muted">{from(o.kind)}</span></p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 md:grid-cols-3 md:px-6">
          {[
            ["Secure checkout", "Payments run through Stripe. We never see your card."],
            ["Own your code", "Templates and custom builds come with the full source code."],
            ["One account", "Purchases, projects, lessons and sites all live in one dashboard."],
          ].map(([t, d]) => (
            <div key={t}><h3 className="font-medium">{t}</h3><p className="mt-2 text-sm text-muted">{d}</p></div>
          ))}
        </div>
      </section>
    </>
  );
}
