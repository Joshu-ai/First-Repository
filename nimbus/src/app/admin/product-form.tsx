"use client";
import { useActionState } from "react";
import { saveProduct } from "@/lib/admin-actions";

type P = { slug: string; name: string; tagline: string; description: string; price_cents: number; category: string; features: string; active: number; file_name: string | null; kind: string; plan_sites: number };

export function ProductForm({ p }: { p?: P }) {
  const [state, action, pending] = useActionState(saveProduct, undefined);
  const i = "mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Name<input name="name" required defaultValue={p?.name} className={i} /></label>
      <label className="text-sm">Slug (URL)<input name="slug" required defaultValue={p?.slug} readOnly={!!p} className={i} /></label>
      <label className="text-sm">Price (USD, monthly for hosting)<input name="price" type="number" step="0.01" min="0.5" required defaultValue={p ? p.price_cents / 100 : ""} className={i} /></label>
      <label className="text-sm">Type<select name="kind" defaultValue={p?.kind ?? "download"} disabled={!!p} className={i}><option value="download">Template / download</option><option value="service">Website service</option><option value="course">Course</option><option value="hosting">Hosting plan (monthly)</option></select>{p && <input type="hidden" name="kind" value={p.kind} />}</label>
      <label className="text-sm">Sites allowed (hosting plans only)<input name="plan_sites" type="number" min="0" defaultValue={p?.plan_sites ?? 0} className={i} /></label>
      <label className="text-sm">Category<input name="category" required defaultValue={p?.category ?? "Starter"} className={i} /></label>
      <label className="text-sm sm:col-span-2">Tagline<input name="tagline" defaultValue={p?.tagline} className={i} /></label>
      <label className="text-sm sm:col-span-2">Description<textarea name="description" rows={3} defaultValue={p?.description} className={i} /></label>
      <label className="text-sm sm:col-span-2">Features (one per line)<textarea name="features" rows={3} defaultValue={p ? (JSON.parse(p.features) as string[]).join("\n") : ""} className={i} /></label>
      <label className="text-sm">Deliverable file (.zip / .tar.gz){p?.file_name && <span className="ml-1 text-xs text-muted">current: {p.file_name}</span>}<input name="file" type="file" className={`${i} file:mr-3 file:rounded file:border-0 file:bg-bg-soft file:px-2`} /></label>
      <label className="flex items-center gap-2 self-end text-sm"><input name="active" type="checkbox" defaultChecked={p ? !!p.active : true} /> Listed in store</label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="h-9 rounded-md bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">{pending ? "Saving..." : p ? "Save changes" : "Add product"}</button>
        {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
        {state?.ok && <span className="text-sm text-green-600 dark:text-green-400">{state.ok}</span>}
      </div>
    </form>
  );
}
