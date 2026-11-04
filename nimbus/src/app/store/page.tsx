import Link from "next/link";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store" };

export default function Store() {
  const products = q.products("download");
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 md:px-6">
      <h1 className="text-4xl font-bold tracking-tight">Templates & Kits</h1>
      <p className="mt-2 text-muted">Production-ready starters. Pay once, use forever.</p>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((p, i) => (
          <Link key={p.id} href={`/store/${p.slug}`} className="group flex flex-col overflow-hidden rounded-lg border border-line hover:border-muted">
            <div className="aspect-[4/3]" style={{ background: `linear-gradient(135deg, hsl(${(i * 70 + 200) % 360} 70% 50% / .3), transparent)` }} />
            <div className="flex flex-1 flex-col p-4">
              <span className="text-xs text-muted">{p.category}</span>
              <h2 className="mt-1 font-medium group-hover:underline">{p.name}</h2>
              <p className="mt-1 flex-1 text-sm text-muted">{p.tagline}</p>
              <p className="mt-4 font-semibold">{money(p.price_cents)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
