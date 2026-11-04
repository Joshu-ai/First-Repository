"use client";
import { useActionState, useState } from "react";
import { createSite, deploySite } from "@/lib/hosting-actions";
import { checkDomainNow, connectDomain } from "@/lib/domain-actions";

const input = "mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent";
const Msg = ({ s }: { s?: { error?: string; ok?: string } }) =>
  s?.error ? <p className="text-sm text-red-600 dark:text-red-400">{s.error}</p> : s?.ok ? <p className="text-sm text-green-600 dark:text-green-400">{s.ok}</p> : null;

export function NewSiteForm({ suffix }: { suffix: string }) {
  const [state, action, pending] = useActionState(createSite, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-sm">Site name<input name="name" required className={input} placeholder="My portfolio" /></label>
      <label className="text-sm">Address<div className="flex items-center gap-1"><input name="slug" required pattern="[a-z0-9-]{3,40}" className={input} placeholder="my-portfolio" /><span className="mt-1 shrink-0 text-xs text-muted">{suffix}</span></div></label>
      <button disabled={pending} className="h-10 rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">{pending ? "Creating..." : "Create site"}</button>
      <div className="sm:col-span-3"><Msg s={state} /></div>
    </form>
  );
}

export function DeployForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(deploySite, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <input name="file" type="file" accept=".zip,.tgz,.tar.gz,application/zip,application/gzip" required className="text-sm file:mr-3 file:rounded file:border file:border-line file:bg-bg-soft file:px-3 file:py-1.5" />
      <button disabled={pending} className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">{pending ? "Deploying..." : "Deploy"}</button>
      <Msg s={state} />
    </form>
  );
}

export function ConnectDomainForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(connectDomain, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <input name="domain" required aria-label="Your domain" placeholder="example.com" autoCapitalize="none" spellCheck={false} className={`${input} mt-0 max-w-xs`} />
      <button disabled={pending} className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">{pending ? "Adding..." : "Connect domain"}</button>
      <Msg s={state} />
    </form>
  );
}

export function CheckDomainButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(checkDomainNow, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">{pending ? "Checking..." : "Check now"}</button>
      <Msg s={state} />
    </form>
  );
}

export function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="group flex max-w-full items-center gap-2 text-left font-mono text-xs"
      title="Copy"
    >
      <span className="break-all">{value}</span>
      <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-sans text-[10px] text-muted group-hover:text-fg">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}
