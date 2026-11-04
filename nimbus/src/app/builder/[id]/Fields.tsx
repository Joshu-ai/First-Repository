"use client";
import { useRef, useState } from "react";
import type { Field } from "@/lib/builder/sections";
import type { Data, Link } from "@/lib/builder/types";

export const inputCls = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent";
export const labelCls = "grid gap-1 text-xs font-medium text-muted";

export function TextInput({ label, value, onChange, placeholder, list }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string }) {
  return <label className={labelCls}>{label}<input className={inputCls} value={value ?? ""} placeholder={placeholder} list={list} onChange={(e) => onChange(e.target.value)} /></label>;
}

/** Shrinks an uploaded photo in the browser so sites stay fast and saves stay small. */
async function shrink(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(im.naturalWidth * k);
    c.height = Math.round(im.naturalHeight * k);
    c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
    const png = file.type === "image/png" && file.size < 300_000;
    return c.toDataURL(png ? "image/png" : "image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const v = value || "";
  const isPh = !v || v.startsWith("ph:");
  return (
    <div className={labelCls}>
      {label}
      <div className="flex items-center gap-3">
        <div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded border border-line bg-bg-soft text-[10px] text-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {isPh ? (v ? `Sample art ${v.slice(3)}` : "No image") : <img src={v} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="rounded border border-line px-2 py-1 text-xs text-fg hover:bg-bg-soft" onClick={() => file.current?.click()} disabled={busy}>{busy ? "Uploading..." : "Upload"}</button>
          <button type="button" className="rounded border border-line px-2 py-1 text-xs text-fg hover:bg-bg-soft" onClick={() => onChange(`ph:${((Number(v.slice(3)) || 0) % 6) + 1}`)}>Sample art</button>
          {v && <button type="button" className="rounded border border-line px-2 py-1 text-xs text-fg hover:bg-bg-soft" onClick={() => onChange("")}>Remove</button>}
        </div>
      </div>
      <input
        className={inputCls} placeholder="or paste an image URL (https://...)" value={isPh || v.startsWith("data:") ? "" : v}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      {err && <span className="text-red-500">{err}</span>}
      <input
        ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 25_000_000) return setErr("That file is over 25 MB.");
          setBusy(true); setErr("");
          try { onChange(await shrink(f)); } catch { setErr("Couldn't read that image."); } finally { setBusy(false); }
        }}
      />
    </div>
  );
}

export function LinkField({ label, value, onChange }: { label: string; value: Link | undefined; onChange: (v: Link) => void }) {
  const l = value ?? { label: "", href: "" };
  return (
    <fieldset className="grid gap-1.5 rounded-md border border-line p-2.5">
      <legend className="px-1 text-xs font-medium text-muted">{label}</legend>
      <div className="grid grid-cols-2 gap-1.5">
        <input className={inputCls} placeholder="Button text" value={l.label} onChange={(e) => onChange({ ...l, label: e.target.value })} />
        <input className={inputCls} placeholder="/page, #section or URL" list="nb-links" value={l.href} onChange={(e) => onChange({ ...l, href: e.target.value })} />
      </div>
      <span className="text-[11px] text-muted">Leave the text empty to hide the button.</span>
    </fieldset>
  );
}

function ListField({ f, value, onChange }: { f: Extract<Field, { kind: "list" }>; value: Data[]; onChange: (v: Data[]) => void }) {
  const items = Array.isArray(value) ? value : [];
  const [open, setOpen] = useState<number | null>(null);
  const set = (i: number, v: Data) => onChange(items.map((x, j) => (j === i ? v : x)));
  const swap = (i: number, j: number) => { const o = [...items]; [o[i], o[j]] = [o[j], o[i]]; onChange(o); setOpen(j); };
  const title = (it: Data, i: number) => String(it.title || it.name || it.q || it.quote || it.caption || it.value || `${f.itemLabel} ${i + 1}`).slice(0, 40);
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted">{f.label}</p>
      {items.map((it, i) => (
        <div key={i} className="rounded-md border border-line">
          <div className="flex items-center gap-1 px-2 py-1.5">
            <button type="button" className="flex-1 truncate text-left text-sm" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "▾" : "▸"} {title(it, i)}</button>
            <button type="button" aria-label="Move up" className="px-1 text-muted hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</button>
            <button type="button" aria-label="Move down" className="px-1 text-muted hover:text-fg disabled:opacity-30" disabled={i === items.length - 1} onClick={() => swap(i, i + 1)}>↓</button>
            <button type="button" aria-label="Remove" className="px-1 text-muted hover:text-red-500" onClick={() => { onChange(items.filter((_, j) => j !== i)); setOpen(null); }}>✕</button>
          </div>
          {open === i && <div className="grid gap-2.5 border-t border-line p-2.5"><Fields fields={f.item} data={it} onChange={(k, v) => set(i, { ...it, [k]: v })} /></div>}
        </div>
      ))}
      <button type="button" className="rounded-md border border-dashed border-line py-1.5 text-sm text-muted hover:text-fg" onClick={() => { onChange([...items, structuredClone(f.newItem)]); setOpen(items.length); }}>+ Add {f.itemLabel.toLowerCase()}</button>
    </div>
  );
}

export function Fields({ fields, data, onChange }: { fields: Field[]; data: Data; onChange: (key: string, v: unknown) => void }) {
  return (
    <>
      {fields.map((f) => {
        const v = data[f.key];
        switch (f.kind) {
          case "text": return <TextInput key={f.key} label={f.label} value={v ?? ""} onChange={(x) => onChange(f.key, x)} />;
          case "textarea": return <label key={f.key} className={labelCls}>{f.label}<textarea className={`${inputCls} min-h-20`} rows={3} value={v ?? ""} onChange={(e) => onChange(f.key, e.target.value)} /></label>;
          case "toggle": return <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v} onChange={(e) => onChange(f.key, e.target.checked)} />{f.label}</label>;
          case "select": return <label key={f.key} className={labelCls}>{f.label}<select className={inputCls} value={v ?? f.options[0][0]} onChange={(e) => onChange(f.key, e.target.value)}>{f.options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select></label>;
          case "image": return <ImageField key={f.key} label={f.label} value={v} onChange={(x) => onChange(f.key, x)} />;
          case "link": return <LinkField key={f.key} label={f.label} value={v} onChange={(x) => onChange(f.key, x)} />;
          case "list": return <ListField key={f.key} f={f} value={v} onChange={(x) => onChange(f.key, x)} />;
        }
      })}
    </>
  );
}
