import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PROJECT_STAGES, q } from "@/lib/db";
import { sendMessage, updateProject } from "@/lib/project-actions";
import { BriefForm } from "./brief-form";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const user = await requireUser(`/dashboard/projects/${id}`);
  const p = q.projectById(id);
  if (!p || (p.user_id !== user.id && !user.is_admin)) notFound();
  const brief = p.brief ? (JSON.parse(p.brief) as Record<string, string>) : null;
  const messages = q.projectMessages(id);
  const stage = PROJECT_STAGES.indexOf(p.status as (typeof PROJECT_STAGES)[number]);
  return (
    <div>
      <Link href={user.is_admin && p.user_id !== user.id ? "/admin" : "/dashboard/projects"} className="text-sm text-muted hover:text-fg">← Back</Link>
      <h2 className="mt-4 text-2xl font-semibold">{p.product_name} website · #{p.id}</h2>
      {user.is_admin ? <p className="text-sm text-muted">Customer: {p.customer_name} ({p.email})</p> : null}

      <ol className="mt-8 grid grid-cols-5 gap-2 text-center text-xs">
        {PROJECT_STAGES.map((s, i) => (
          <li key={s} className={`rounded-md border px-2 py-2 capitalize ${i <= stage ? "border-fg bg-fg text-bg" : "border-line text-muted"}`}>{s}</li>
        ))}
      </ol>
      {p.live_url && <p className="mt-4 text-sm">Live at <a href={p.live_url} className="underline" target="_blank" rel="noreferrer">{p.live_url}</a></p>}

      {user.is_admin ? (
        <form action={updateProject} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-line p-4">
          <input type="hidden" name="projectId" value={p.id} />
          <label className="text-sm">Stage<select name="status" defaultValue={p.status} className="mt-1 block rounded-md border border-line bg-bg px-2 py-1.5 capitalize">{PROJECT_STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="flex-1 text-sm">Live URL<input name="live_url" defaultValue={p.live_url ?? ""} placeholder="https://" className="mt-1 block w-full rounded-md border border-line bg-bg px-2 py-1.5" /></label>
          <button className="h-9 rounded-md bg-fg px-4 text-sm text-bg">Update</button>
        </form>
      ) : null}

      <section className="mt-10">
        <h3 className="font-semibold">Brief</h3>
        {brief ? (
          <dl className="mt-4 grid gap-4 rounded-lg border border-line p-5 sm:grid-cols-2">
            {Object.entries(brief).filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-xs capitalize text-muted">{k}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{v}</dd></div>
            ))}
          </dl>
        ) : p.user_id === user.id ? (
          <div className="mt-4 rounded-lg border border-line p-5"><p className="mb-4 text-sm text-muted">Tell us about your project so we can start designing.</p><BriefForm projectId={p.id} /></div>
        ) : <p className="mt-2 text-sm text-muted">Waiting for the customer to submit their brief.</p>}
      </section>

      <section className="mt-10">
        <h3 className="font-semibold">Messages</h3>
        <ul className="mt-4 space-y-3">
          {messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
          {messages.map((m) => (
            <li key={m.id} className={`rounded-lg border border-line p-4 ${m.is_admin ? "bg-bg-soft" : ""}`}>
              <p className="text-xs text-muted">{m.name}{m.is_admin ? " · team" : ""} · {m.created_at}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          ))}
        </ul>
        <form action={sendMessage} className="mt-4 flex gap-2">
          <input type="hidden" name="projectId" value={p.id} />
          <textarea name="body" required rows={2} placeholder="Write a message..." className="flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm" />
          <button className="h-10 self-end rounded-md bg-fg px-4 text-sm text-bg">Send</button>
        </form>
      </section>
    </div>
  );
}
