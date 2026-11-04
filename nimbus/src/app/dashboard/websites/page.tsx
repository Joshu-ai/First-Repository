import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { siteLiveUrl } from "@/lib/hosting";
import { deleteWebsite } from "@/lib/builder/actions";

export const metadata = { title: "My websites" };

export default async function Websites() {
  const user = await requireUser("/dashboard/websites");
  const sites = q.builderSitesForUser(user.id);
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Websites</h2>
        <Link href="/builder#templates" className="h-9 rounded-md bg-fg px-4 text-sm font-medium leading-9 text-bg hover:opacity-90">New website</Link>
      </div>
      {!sites.length ? (
        <div className="mt-8 rounded-xl border border-dashed border-line p-10 text-center">
          <p className="text-muted">You haven&apos;t built a website yet.</p>
          <Link href="/builder#templates" className="mt-4 inline-block underline">Pick a template to start</Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {sites.map((s) => {
            const subs = s.submissions ? q.submissions(s.id) : [];
            return (
              <li key={s.id} className="rounded-lg border border-line p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    {s.slug ? <a href={siteLiveUrl(s.slug)} target="_blank" rel="noreferrer" className="text-sm text-accent underline">{siteLiveUrl(s.slug)}</a> : <p className="text-sm text-muted">Not published yet</p>}
                    <p className="mt-1 text-xs text-muted">Edited {s.updated_at}{s.published_at ? ` · published ${s.published_at}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/builder/${s.id}`} className="h-9 rounded-md bg-fg px-4 text-sm font-medium leading-9 text-bg hover:opacity-90">Edit</Link>
                    <a href={`/api/builder/${s.id}/export`} className="h-9 rounded-md border border-line px-3 text-sm leading-9 hover:bg-bg-soft">Export</a>
                    <form action={deleteWebsite}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="unpublish" value="1" />
                      <button className="text-xs text-red-600 hover:underline dark:text-red-400">Delete</button>
                    </form>
                  </div>
                </div>
                {subs.length > 0 && (
                  <details className="mt-4 border-t border-line pt-4">
                    <summary className="cursor-pointer text-sm font-medium">Form messages ({s.submissions})</summary>
                    <ul className="mt-3 space-y-3">
                      {subs.map((m) => {
                        const d = JSON.parse(m.data) as { name: string; email: string; message: string };
                        return (
                          <li key={m.id} className="rounded-md bg-bg-soft p-3 text-sm">
                            <p><b>{d.name}</b> · <a className="underline" href={`mailto:${d.email}`}>{d.email}</a> <span className="text-xs text-muted">· {m.created_at}</span></p>
                            <p className="mt-1 whitespace-pre-wrap text-muted">{d.message}</p>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
