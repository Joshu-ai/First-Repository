import { q } from "@/lib/db";
import { money } from "@/lib/brand";
import { BuyButton } from "@/components/BuyButton";
import { currentUser } from "@/lib/auth";
import { testCheckout } from "@/lib/payments";
import { CodeBlock } from "@/components/CodeBlock";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hosting" };

export default async function Hosting() {
  const plans = q.products("hosting");
  const user = await currentUser();
  const current = user ? q.activePlan(user.id) : undefined;
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="mx-auto max-w-4xl px-4 pt-24 pb-12 text-center">
          <h1 className="text-5xl font-bold tracking-tighter md:text-6xl">Upload. You&apos;re live.</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">Fast hosting for static sites. Drop in your build and get a live URL in seconds. No servers to manage.</p>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-4 pb-16">
        <div className="grid gap-6 md:grid-cols-2">
          {plans.map((p, i) => (
            <div key={p.id} className={`flex flex-col rounded-xl border p-6 ${i === 1 ? "border-fg" : "border-line"}`}>
              <h2 className="text-xl font-semibold">{p.name}</h2>
              <p className="mt-1 text-sm text-muted">{p.tagline}</p>
              <p className="mt-6 text-4xl font-bold">{money(p.price_cents)}<span className="text-base font-normal text-muted">/month</span></p>
              <ul className="mt-6 flex-1 space-y-2 text-sm">{(JSON.parse(p.features) as string[]).map((f) => <li key={f}>✓ {f}</li>)}</ul>
              <div className="mt-8">
                {current?.id === p.id
                  ? <p className="flex h-11 items-center justify-center rounded-md border border-line text-sm">Your current plan</p>
                  : <BuyButton slug={p.slug} label={user ? (current ? `Switch to ${p.name}` : `Start ${p.name}`) : "Log in to start"} className={i === 1 ? "" : "border border-line hover:bg-bg-soft"} />}
              </div>
            </div>
          ))}
        </div>
        {testCheckout && <p className="mt-4 text-center text-xs text-amber-600 dark:text-amber-400">Test mode: checkout completes instantly without payment.</p>}
        <p className="mt-4 text-center text-xs text-muted">Cancel anytime. Plans renew monthly.</p>
      </section>
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Works with any static build</h2>
            <p className="mt-3 text-muted">Next.js static export, Astro, Vite, plain HTML. Zip the output folder and upload it from your dashboard.</p>
          </div>
          <CodeBlock file="next.config.ts" lang="ts" source={`export default {\n  output: "export",\n}\n\n// npm run build, then zip the out/ folder`} />
        </div>
      </section>
    </>
  );
}
