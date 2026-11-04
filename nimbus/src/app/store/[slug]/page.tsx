import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";
import { currentUser } from "@/lib/auth";
import { buy } from "@/lib/store-actions";
import { testCheckout } from "@/lib/payments";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ canceled?: string }> }) {
  const p = q.productBySlug((await params).slug);
  if (!p || !p.active) notFound();
  const { canceled } = await searchParams;
  const user = await currentUser();
  const owned = user ? q.paidOrderFor(user.id, p.id) : undefined;
  const features: string[] = JSON.parse(p.features);
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 md:grid-cols-[1fr_360px] md:px-6">
      <div>
        <Link href="/store" className="text-sm text-muted hover:text-fg">← All templates</Link>
        <div className="mt-6 aspect-video rounded-xl border border-line" style={{ background: `linear-gradient(135deg, hsl(${(p.id * 70 + 130) % 360} 70% 50% / .3), transparent)` }} />
        <h1 className="mt-8 text-4xl font-bold tracking-tight">{p.name}</h1>
        <p className="mt-3 text-lg text-muted">{p.tagline}</p>
        <p className="mt-6 leading-7 text-muted">{p.description}</p>
      </div>
      <aside className="h-fit rounded-xl border border-line p-6 md:sticky md:top-24">
        <p className="text-3xl font-bold">{money(p.price_cents)}</p>
        <p className="mt-1 text-sm text-muted">One-time payment · Lifetime access</p>
        <ul className="mt-6 space-y-2 text-sm">
          {features.map((f) => <li key={f} className="flex gap-2"><span aria-hidden>✓</span>{f}</li>)}
        </ul>
        {canceled && <p className="mt-4 text-sm text-muted">Checkout canceled. You weren&apos;t charged.</p>}
        {owned ? (
          <Link href="/dashboard" className="mt-6 flex h-11 items-center justify-center rounded-md border border-line font-medium">You own this · Go to downloads</Link>
        ) : (
          <form action={buy} className="mt-6">
            <input type="hidden" name="slug" value={p.slug} />
            <button className="h-11 w-full rounded-md bg-fg font-medium text-bg hover:opacity-90">{user ? "Buy now" : "Log in to buy"}</button>
          </form>
        )}
        {testCheckout && !owned && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Test mode: Stripe isn&apos;t configured, so purchases complete instantly without payment.</p>}
      </aside>
    </div>
  );
}
