import { q } from "@/lib/db";
import { money } from "@/lib/brand";
import { BuyButton } from "@/components/BuyButton";
import { currentUser } from "@/lib/auth";
import { testCheckout } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const metadata = { title: "Website services" };

const steps = [
  ["Pick a package", "Pay securely online. You get a project space right away."],
  ["Share your brief", "Tell us about your brand, pages and goals in a short form."],
  ["We design and build", "Follow progress and message us from your dashboard."],
  ["Launch", "We connect your domain, go live and hand over the code."],
];
const faq = [
  ["How long does it take?", "Launch sites usually go live in about two weeks; larger packages take 4 to 8 weeks depending on scope."],
  ["Do I own the code?", "Yes. When the project launches you get the full source code and can host it anywhere."],
  ["What if I need changes later?", "Every package includes revisions and a support window. After that, you can message us for a quote."],
  ["Can I get a refund?", "If we haven't started design yet, we'll refund you in full. Contact support from your dashboard."],
];

export default async function Services() {
  const packages = q.products("service");
  const user = await currentUser();
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="mx-auto max-w-4xl px-4 pt-24 pb-16 text-center">
          <h1 className="text-5xl font-bold tracking-tighter md:text-6xl">We build your website.<br />You run your business.</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">Fixed prices, clear timelines, and a dashboard where you can follow every step from brief to launch.</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-20 md:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {packages.map((p, i) => (
            <div key={p.id} className={`flex flex-col rounded-xl border p-6 ${i === 1 ? "border-fg" : "border-line"}`}>
              {i === 1 && <span className="mb-3 w-fit rounded-full bg-fg px-2 py-0.5 text-xs text-bg">Most popular</span>}
              <h2 className="text-xl font-semibold">{p.name}</h2>
              <p className="mt-1 text-sm text-muted">{p.tagline}</p>
              <p className="mt-6 text-4xl font-bold">{money(p.price_cents)}</p>
              <p className="text-xs text-muted">one-time</p>
              <ul className="mt-6 flex-1 space-y-2 text-sm">{(JSON.parse(p.features) as string[]).map((f) => <li key={f}>✓ {f}</li>)}</ul>
              <div className="mt-8"><BuyButton slug={p.slug} label={user ? `Start ${p.name}` : "Log in to start"} className={i === 1 ? "" : "border border-line hover:bg-bg-soft"} /></div>
            </div>
          ))}
        </div>
        {testCheckout && <p className="mt-4 text-center text-xs text-amber-600 dark:text-amber-400">Test mode: Stripe isn&apos;t configured, so checkout completes instantly without payment.</p>}
      </section>
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {steps.map(([t, d], i) => (
              <li key={t} className="rounded-lg border border-line p-5"><span className="text-sm text-muted">Step {i + 1}</span><h3 className="mt-1 font-medium">{t}</h3><p className="mt-2 text-sm text-muted">{d}</p></li>
            ))}
          </ol>
        </div>
      </section>
      <section className="border-t border-line">
        <div className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {faq.map(([qq, a]) => (
              <details key={qq} className="py-4"><summary className="cursor-pointer font-medium">{qq}</summary><p className="mt-2 text-muted">{a}</p></details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
