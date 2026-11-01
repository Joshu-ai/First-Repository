import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";
import { hostingDomain, siteLiveUrl } from "@/lib/hosting";
import { deleteSite } from "@/lib/hosting-actions";
import { DeployForm, NewSiteForm } from "./forms";

export const metadata = { title: "Hosting" };

const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

export default async function Sites({ searchParams }: { searchParams: Promise<{ purchased?: string }> }) {
  const user = await requireUser("/dashboard/sites");
  const plan = q.activePlan(user.id);
  const sites = q.sitesForUser(user.id);
  const { purchased } = await searchParams;
  const d = hostingDomain();
  return (
    <div>
      <h2 className="text-xl font-semibold">Hosting</h2>
      {purchased && <p role="status" className="mt-6 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">Your plan is active. Create a site and upload your build to go live.</p>}
      {!plan ? (
        <div className="mt-8 rounded-xl border border-dashed border-line p-10 text-center">
          <p className="text-muted">You don&apos;t have a hosting plan yet.</p>
          <Link href="/hosting" className="mt-4 inline-block underline">See hosting plans</Link>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4 text-sm">
            <span><b>{plan.name}</b> · {money(plan.price_cents)}/month · {sites.length} of {plan.plan_sites} site{plan.plan_sites === 1 ? "" : "s"} used{plan.current_period_end ? ` · renews ${plan.current_period_end.slice(0, 10)}` : ""}</span>
            {plan.plan_sites < 10 && <Link href="/hosting" className="underline">Upgrade</Link>}
          </div>
          {sites.length < plan.plan_sites && (
            <div className="mt-6 rounded-lg border border-line p-5"><h3 className="mb-4 font-medium">New site</h3><NewSiteForm suffix={d ? `.${d}` : ""} /></div>
          )}
          <ul className="mt-6 space-y-4">
            {sites.map((s) => (
              <li key={s.id} className="rounded-lg border border-line p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    {s.deployed_at
                      ? <a href={siteLiveUrl(s.slug)} target="_blank" rel="noreferrer" className="text-sm text-accent underline">{siteLiveUrl(s.slug)}</a>
                      : <p className="text-sm text-muted">Not deployed yet</p>}
                    {s.deployed_at && <p className="mt-1 text-xs text-muted">Last deploy {s.deployed_at} · {s.file_count} files · {size(s.bytes)}</p>}
                  </div>
                  <form action={deleteSite}><input type="hidden" name="slug" value={s.slug} /><button className="text-xs text-red-600 hover:underline dark:text-red-400">Delete site</button></form>
                </div>
                <div className="mt-4 border-t border-line pt-4"><DeployForm slug={s.slug} /></div>
                <p className="mt-2 text-xs text-muted">Upload a .zip or .tar.gz of your built static site (for Next.js: set output: &quot;export&quot; and upload the out/ folder).</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
