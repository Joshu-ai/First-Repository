import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { createWebsite } from "@/lib/builder/actions";
import { TEMPLATES } from "@/lib/builder/templates";
import { SECTIONS } from "@/lib/builder/sections";

export const metadata = { title: "Website builder", description: "Pick a template, edit it visually, and publish your site in minutes." };
export const dynamic = "force-dynamic";

const steps = [
  ["Pick a template", "Start from a design made for your kind of business, or a blank page."],
  ["Make it yours", "Click any text to change it. Add sections, pages and photos. Switch colors and fonts in one click."],
  ["Publish", "Go live on a Nimbus address with free SSL, or download the files and host them anywhere."],
];

export default async function BuilderHome({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const user = await currentUser();
  const mine = user ? q.builderSitesForUser(user.id) : [];
  const { start } = await searchParams;
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="mx-auto max-w-5xl px-4 pt-20 pb-16 text-center md:pt-28">
          <p className="mb-5 inline-flex rounded-full border border-line bg-bg-soft px-3 py-1 text-xs text-muted">Nimbus Website Builder</p>
          <h1 className="text-5xl font-bold tracking-tighter md:text-6xl">Build a beautiful website.<br className="hidden sm:block" /> No code needed.</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">Choose a template, click to edit anything, and publish to the web in minutes. Every site is fast, mobile-friendly and yours to export.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#templates" className="flex h-11 items-center rounded-md bg-fg px-6 font-medium text-bg hover:opacity-90">Choose a template</a>
            {mine.length > 0 && <Link href="/dashboard/websites" className="flex h-11 items-center rounded-md border border-line px-6 font-medium hover:bg-bg-soft">My websites ({mine.length})</Link>}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-14 md:grid-cols-3 md:px-6">
        {steps.map(([t, d], i) => (
          <div key={t}><p className="font-mono text-sm text-muted">0{i + 1}</p><h2 className="mt-1 font-semibold">{t}</h2><p className="mt-1 text-sm text-muted">{d}</p></div>
        ))}
      </section>

      <section id="templates" className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-24 md:px-6">
        <h2 className="text-3xl font-bold tracking-tight">Templates</h2>
        <p className="mt-2 text-muted">Every template is a starting point. Change any color, font, section or page.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <div key={t.id} id={`t-${t.id}`} className={`group overflow-hidden rounded-xl border bg-bg ${start === t.id ? "border-accent ring-2 ring-accent" : "border-line"}`}>
              <div className="relative aspect-[4/3] overflow-hidden border-b border-line bg-bg-soft">
                {t.id === "blank" ? (
                  <div className="grid h-full place-items-center text-sm text-muted">Blank page</div>
                ) : (
                  <iframe src={`/builder/preview/${t.id}`} title={`${t.name} preview`} loading="lazy" tabIndex={-1} aria-hidden
                    className="pointer-events-none absolute left-0 top-0 h-[300%] w-[300%] origin-top-left scale-[0.3333] border-0" />
                )}
              </div>
              <div className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted">{t.category}</p>
                <h3 className="mt-1 text-lg font-semibold">{t.name}</h3>
                <p className="mt-1 text-sm text-muted">{t.blurb}</p>
                <div className="mt-4 flex gap-2">
                  <form action={createWebsite}>
                    <input type="hidden" name="template" value={t.id} />
                    <button className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg hover:opacity-90">{user ? "Start with this" : "Sign up to start"}</button>
                  </form>
                  {t.id !== "blank" && <a href={`/builder/preview/${t.id}`} target="_blank" rel="noreferrer" className="flex h-9 items-center rounded-md border border-line px-4 text-sm hover:bg-bg-soft">Preview</a>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-4 md:px-6">
          {[
            ["Edit on the page", "Click a headline and type. What you see is exactly what goes live."],
            [`${SECTIONS.length} section types`, "Heroes, galleries, menus, pricing, team, FAQs, contact forms and more."],
            ["Forms that work", "Contact form messages land in your dashboard and your inbox."],
            ["No lock-in", "Download your site as plain HTML files whenever you want."],
          ].map(([t, d]) => <div key={t}><h3 className="font-medium">{t}</h3><p className="mt-2 text-sm text-muted">{d}</p></div>)}
        </div>
      </section>
    </>
  );
}
