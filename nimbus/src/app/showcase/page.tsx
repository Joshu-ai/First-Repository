import { ShowcaseGrid } from "./grid";
import Link from "next/link";
import { templates } from "@/lib/data";

export const metadata = { title: "Showcase" };

const stats = [["10k+", "Sites shipped"], ["1.2M", "Weekly installs"], ["3.4k", "Contributors"], ["99.99%", "Uptime target"]];

export default function Showcase() {
  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pt-20 pb-12 text-center">
        <h1 className="text-5xl font-bold tracking-tighter">Built with Nimbus</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">Placeholder: teams of every size ship with this framework. Here are a few (fictional) examples.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/docs" className="flex h-10 items-center rounded-md bg-fg px-5 text-sm font-medium text-bg">Start building</Link>
          <Link href="/store" className="flex h-10 items-center rounded-md border border-line px-5 text-sm">View templates</Link>
        </div>
        <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          {stats.map(([n, l]) => (<div key={l} className="bg-bg p-6"><dt className="text-sm text-muted">{l}</dt><dd className="mt-1 text-3xl font-semibold">{n}</dd></div>))}
        </dl>
        <p className="mt-2 text-xs text-muted">Stats are placeholders.</p>
      </section>
      <section className="mx-auto max-w-7xl px-4 pb-20 md:px-6">
        <h2 className="mb-6 text-2xl font-semibold">Explore the showcase</h2>
        <ShowcaseGrid />
      </section>
      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-6">
          <h2 className="text-2xl font-semibold">Build with templates</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {templates.map((t) => (
              <div key={t.title} className="rounded-lg border border-line p-6"><h3 className="font-medium">{t.title}</h3><p className="mt-1 text-sm text-muted">{t.description}</p><code className="mt-4 block font-mono text-xs text-muted">{t.repo}</code></div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
