"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishWebsite, saveWebsite, type PublishResult } from "@/lib/builder/actions";
import { cloneSection, findSection, mapPage, mapSection, move, newSection, setField } from "@/lib/builder/ops";
import { fontsHref, pagePrefix, renderBody, renderPage, themeCss, type RenderCtx } from "@/lib/builder/render";
import { SECTION_GROUPS, SECTIONS, spec } from "@/lib/builder/sections";
import { FONTS, PALETTES, slugify, uid, type Page, type SiteDoc, type Tone } from "@/lib/builder/types";
import { Fields, inputCls, labelCls, LinkField, TextInput } from "./Fields";

type Props = { id: number; initial: SiteDoc; publishedSlug: string | null; liveUrl: string | null; addressSuffix: string; addressPrefix: string };
type Device = "desktop" | "tablet" | "phone";
const WIDTH: Record<Device, string> = { desktop: "100%", tablet: "820px", phone: "390px" };
const TONES: [Tone, string][] = [["light", "Light"], ["muted", "Soft"], ["dark", "Dark"], ["accent", "Accent"]];

/** Undo/redo history. Rapid edits to the same field are merged into one step. */
function useHistory(initial: SiteDoc) {
  const [doc, setDoc] = useState(initial);
  const h = useRef({ past: [] as SiteDoc[], future: [] as SiteDoc[], key: "", at: 0 });
  const [, bump] = useState(0);
  const commit = useCallback((next: SiteDoc | ((d: SiteDoc) => SiteDoc), key = "") => {
    setDoc((cur) => {
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      const now = Date.now();
      if (!(key && key === h.current.key && now - h.current.at < 800)) h.current.past = [...h.current.past.slice(-99), cur];
      h.current.future = [];
      h.current.key = key;
      h.current.at = now;
      return n;
    });
    bump((x) => x + 1);
  }, []);
  const undo = useCallback(() => {
    setDoc((cur) => {
      const prev = h.current.past.pop();
      if (!prev) return cur;
      h.current.future.push(cur);
      h.current.key = "";
      return prev;
    });
    bump((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    setDoc((cur) => {
      const nxt = h.current.future.pop();
      if (!nxt) return cur;
      h.current.past.push(cur);
      h.current.key = "";
      return nxt;
    });
    bump((x) => x + 1);
  }, []);
  return { doc, commit, undo, redo, canUndo: h.current.past.length > 0, canRedo: h.current.future.length > 0 };
}

export default function Editor({ id, initial, publishedSlug, liveUrl: initialLive, addressSuffix, addressPrefix }: Props) {
  const { doc, commit, undo, redo, canUndo, canRedo } = useHistory(initial);
  const [pageId, setPageId] = useState(initial.pages[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"sections" | "pages" | "design">("sections");
  const [device, setDevice] = useState<Device>("desktop");
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [live, setLive] = useState<{ slug: string | null; url: string | null }>({ slug: publishedSlug, url: initialLive });

  const page = doc.pages.find((p) => p.id === pageId) ?? doc.pages[0];
  const frame = useRef<HTMLIFrameElement>(null);
  const skipPatch = useRef(false);
  const lastPage = useRef(initial.pages[0].id);
  const state = useRef({ doc, page, selected });
  state.current = { doc, page, selected };

  const ctx = useCallback((d: SiteDoc, p: Page): RenderCtx => ({ mode: "edit", doc: d, page: p, prefix: pagePrefix(p) }), []);
  // The iframe is created once; later changes are patched in place so typing never reloads the preview.
  const [srcDoc] = useState(() => renderPage(ctx(initial, initial.pages[0])));

  const markSelection = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    d.querySelectorAll(".nb-sel").forEach((el) => el.classList.remove("nb-sel"));
    const sel = state.current.selected;
    if (sel) d.querySelector(`[data-section="${CSS.escape(sel)}"]`)?.classList.add("nb-sel");
  }, []);

  const patch = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d?.body) return;
    const { doc: cd, page: cp } = state.current;
    const theme = d.getElementById("nb-theme");
    if (theme) theme.textContent = themeCss(cd);
    const font = d.getElementById("nb-font") as HTMLLinkElement | null;
    if (font && font.getAttribute("href") !== fontsHref(cd)) font.setAttribute("href", fontsHref(cd));
    d.body.innerHTML = renderBody(ctx(cd, cp));
    if (lastPage.current !== cp.id) { lastPage.current = cp.id; d.defaultView?.scrollTo(0, 0); }
    markSelection();
  }, [ctx, markSelection]);

  useEffect(() => {
    if (skipPatch.current) { skipPatch.current = false; return; }
    patch();
  }, [doc, pageId, patch]);
  useEffect(markSelection, [selected, markSelection]);

  // Clicks and typing inside the preview.
  const onFrameLoad = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    patch();
    d.addEventListener("click", (e) => {
      const el = e.target as HTMLElement;
      const a = el.closest("a");
      if (a) {
        e.preventDefault();
        const slug = a.getAttribute("data-page");
        if (slug !== null && !el.closest("[contenteditable]")) {
          const p = state.current.doc.pages.find((x) => x.slug === slug);
          if (p) { setPageId(p.id); setSelected(null); return; }
        }
      }
      if (el.closest("summary") && !el.closest("[contenteditable]")) e.preventDefault();
      const sec = el.closest("[data-section]");
      if (sec) {
        const sid = sec.getAttribute("data-section")!;
        setSelected(sid);
        setTab("sections");
      }
    });
    d.addEventListener("submit", (e) => e.preventDefault());
    d.addEventListener("input", (e) => {
      const el = (e.target as HTMLElement).closest("[data-edit]") as HTMLElement | null;
      if (!el) return;
      const [sid, path] = el.getAttribute("data-edit")!.split("|");
      skipPatch.current = true;
      commit((cur) => setField(cur, sid, path, el.innerText.replace(/\n$/, "")), `${sid}|${path}`);
    });
    d.addEventListener("keydown", (e) => {
      const el = e.target as HTMLElement;
      const multi = el.matches?.("[data-edit].body, [data-edit].lead, blockquote[data-edit]");
      if (e.key === "Enter" && el.isContentEditable && !multi) { e.preventDefault(); el.blur(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    });
    // Re-render once text editing finishes so other parts that show the same text catch up.
    d.addEventListener("focusout", (e) => { if ((e.target as HTMLElement).isContentEditable) setTimeout(patch, 0); });
  }, [commit, patch, undo, redo]);

  // Keyboard shortcuts in the editor itself.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches("input, textarea, select")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [undo, redo]);

  // Autosave a moment after the last change.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setStatus("unsaved");
    const t = setTimeout(async () => {
      setStatus("saving");
      const r = await saveWebsite(id, JSON.stringify(doc)).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (r.ok) { setStatus("saved"); setSaveError(""); } else { setStatus("error"); setSaveError(r.error); }
    }, 1000);
    return () => clearTimeout(t);
  }, [doc, id]);
  useEffect(() => {
    const w = (e: BeforeUnloadEvent) => { if (status !== "saved") e.preventDefault(); };
    window.addEventListener("beforeunload", w);
    return () => window.removeEventListener("beforeunload", w);
  }, [status]);

  const sel = selected && !selected.startsWith("__") ? findSection(doc, selected) : undefined;
  const selSpec = sel ? spec(sel.type) : undefined;

  const addSection = (type: string) => {
    const s = newSection(type);
    commit((cur) => mapPage(cur, page.id, (p) => {
      const i = p.sections.findIndex((x) => x.id === selected);
      const at = i >= 0 ? i + 1 : p.sections.length;
      return { ...p, sections: [...p.sections.slice(0, at), s, ...p.sections.slice(at)] };
    }));
    setSelected(s.id);
    setAdding(false);
    setTimeout(() => frame.current?.contentDocument?.querySelector(`[data-section="${s.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const sectionAction = (sid: string, act: "up" | "down" | "dup" | "del") =>
    commit((cur) => mapPage(cur, page.id, (p) => {
      const i = p.sections.findIndex((x) => x.id === sid);
      if (act === "up" || act === "down") return { ...p, sections: move(p.sections, i, act === "up" ? -1 : 1) };
      if (act === "dup") { const c = cloneSection(p.sections[i]); return { ...p, sections: [...p.sections.slice(0, i + 1), c, ...p.sections.slice(i + 1)] }; }
      return { ...p, sections: p.sections.filter((x) => x.id !== sid) };
    }));
  const scrollTo = (sid: string) => frame.current?.contentDocument?.querySelector(`[data-section="${CSS.escape(sid)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const linkOptions = useMemo(() => [
    ...doc.pages.map((p) => `/${p.slug}`),
    ...[...new Set(page.sections.map((s) => s.type))].filter((t) => ["contact", "pricing", "menu", "faq", "gallery", "team", "features"].includes(t)).map((t) => `#${t}`),
  ], [doc.pages, page.sections]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
      <datalist id="nb-links">{linkOptions.map((o) => <option key={o} value={o} />)}</datalist>
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3">
        <Link href="/dashboard/websites" className="rounded-md px-2 py-1 text-sm text-muted hover:text-fg" title="My websites">← Sites</Link>
        <input aria-label="Site name" className="w-44 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-line focus:border-line focus:outline-none" value={doc.name} onChange={(e) => commit({ ...doc, name: e.target.value }, "name")} />
        <select aria-label="Page" className="rounded-md border border-line bg-bg px-2 py-1 text-sm" value={page.id} onChange={(e) => { setPageId(e.target.value); setSelected(null); }}>
          {doc.pages.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.slug ? `/${p.slug}` : "home"})</option>)}
        </select>
        <div className="flex gap-1">
          <button className="rounded-md px-2 py-1 text-sm disabled:opacity-30" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
          <button className="rounded-md px-2 py-1 text-sm disabled:opacity-30" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        </div>
        <div className="mx-auto flex rounded-md border border-line p-0.5" role="group" aria-label="Preview size">
          {(["desktop", "tablet", "phone"] as Device[]).map((d) => (
            <button key={d} onClick={() => setDevice(d)} className={`rounded px-2.5 py-1 text-xs capitalize ${device === d ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}>{d}</button>
          ))}
        </div>
        <span className={`text-xs ${status === "error" ? "text-red-500" : "text-muted"}`} title={saveError}>
          {status === "saved" ? "All changes saved" : status === "saving" ? "Saving..." : status === "error" ? saveError || "Not saved" : "Unsaved changes"}
        </span>
        <a href={`/api/builder/${id}/export`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-bg-soft" title="Download the site as static HTML files" onClick={async (e) => { if (status !== "saved") { e.preventDefault(); await saveWebsite(id, JSON.stringify(doc)); setStatus("saved"); window.location.href = `/api/builder/${id}/export`; } }}>Export</a>
        {live.url && <a href={live.url} target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-bg-soft">View live</a>}
        <button onClick={() => setPublishOpen(true)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">{live.slug ? "Update site" : "Publish"}</button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: structure */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-line">
          <div className="flex border-b border-line text-sm">
            {(["sections", "pages", "design"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 capitalize ${tab === t ? "border-b-2 border-fg font-medium" : "text-muted hover:text-fg"}`}>{t}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "sections" && (
              <div className="grid gap-1">
                <SiteRow label="Header & site settings" active={selected === "__site"} onClick={() => setSelected("__site")} />
                {page.sections.map((s, i) => (
                  <div key={s.id} className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${selected === s.id ? "bg-accent/15 ring-1 ring-accent" : "hover:bg-bg-soft"}`}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => { setSelected(s.id); scrollTo(s.id); }}>
                      <span className="block truncate font-medium">{spec(s.type)?.label}</span>
                      <span className="block truncate text-xs text-muted">{String(s.data.heading || s.data.items?.[0]?.name || "") || " "}</span>
                    </button>
                    <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <IconBtn label="Move up" disabled={i === 0} onClick={() => sectionAction(s.id, "up")}>↑</IconBtn>
                      <IconBtn label="Move down" disabled={i === page.sections.length - 1} onClick={() => sectionAction(s.id, "down")}>↓</IconBtn>
                      <IconBtn label="Duplicate" onClick={() => sectionAction(s.id, "dup")}>⧉</IconBtn>
                      <IconBtn label="Delete" onClick={() => { sectionAction(s.id, "del"); if (selected === s.id) setSelected(null); }}>✕</IconBtn>
                    </div>
                  </div>
                ))}
                <SiteRow label="Footer" active={selected === "__footer"} onClick={() => setSelected("__footer")} />
                <button onClick={() => setAdding(true)} className="mt-2 rounded-md border border-dashed border-line py-2 text-sm text-muted hover:border-fg hover:text-fg">+ Add section</button>
                <p className="mt-3 text-xs leading-relaxed text-muted">Tip: click any text in the preview to edit it right there. Click a section to change its layout, images and buttons.</p>
              </div>
            )}
            {tab === "pages" && <PagesPanel doc={doc} commit={commit} current={page.id} onOpen={(pid) => { setPageId(pid); setSelected(null); }} />}
            {tab === "design" && <DesignPanel doc={doc} commit={commit} />}
          </div>
        </aside>

        {/* Center: preview */}
        <div className="min-w-0 flex-1 overflow-auto bg-bg-soft p-4">
          <div className="mx-auto h-full overflow-hidden rounded-lg border border-line bg-white shadow-sm transition-[width]" style={{ width: WIDTH[device], maxWidth: "100%" }}>
            <iframe ref={frame} title="Site preview" sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={onFrameLoad} className="h-full w-full" />
          </div>
        </div>

        {/* Right: inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line p-4">
          {sel && selSpec ? (
            <div className="grid gap-3">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold">{selSpec.label}</h2><p className="text-xs text-muted">{selSpec.description}</p></div>
                <button className="text-muted hover:text-fg" aria-label="Close" onClick={() => setSelected(null)}>✕</button>
              </div>
              <div className={labelCls}>
                Background
                <div className="grid grid-cols-4 gap-1">
                  {TONES.map(([t, l]) => (
                    <button key={t} onClick={() => commit(mapSection(doc, sel.id, (s) => ({ ...s, tone: t })))} className={`rounded border px-1 py-1.5 text-xs ${sel.tone === t ? "border-fg text-fg" : "border-line text-muted hover:text-fg"}`}>{l}</button>
                  ))}
                </div>
              </div>
              <Fields fields={selSpec.fields} data={sel.data} onChange={(k, v) => commit((cur) => setField(cur, sel.id, k, v), `${sel.id}|${k}`)} />
              <div className="mt-2 flex gap-2 border-t border-line pt-3">
                <button className="flex-1 rounded-md border border-line py-1.5 text-sm hover:bg-bg-soft" onClick={() => sectionAction(sel.id, "dup")}>Duplicate</button>
                <button className="flex-1 rounded-md border border-line py-1.5 text-sm text-red-500 hover:bg-bg-soft" onClick={() => { sectionAction(sel.id, "del"); setSelected(null); }}>Delete</button>
              </div>
            </div>
          ) : selected === "__site" ? (
            <div className="grid gap-3">
              <h2 className="font-semibold">Header & site settings</h2>
              <TextInput label="Site name (shown as your logo)" value={doc.name} onChange={(v) => commit({ ...doc, name: v }, "name")} />
              <LinkField label="Header button" value={doc.nav.cta} onChange={(v) => commit({ ...doc, nav: { cta: v } }, "navcta")} />
              <p className="text-xs text-muted">Pages appear in the menu automatically when your site has more than one. Add them in the Pages tab.</p>
            </div>
          ) : selected === "__footer" ? (
            <div className="grid gap-3">
              <h2 className="font-semibold">Footer</h2>
              {([["text", "Short description"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"], ["instagram", "Instagram URL"], ["facebook", "Facebook URL"], ["linkedin", "LinkedIn URL"]] as const).map(([k, l]) => (
                <TextInput key={k} label={l} value={doc.footer[k]} onChange={(v) => commit({ ...doc, footer: { ...doc.footer, [k]: v } }, `foot-${k}`)} />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 text-sm text-muted">
              <h2 className="font-semibold text-fg">Nothing selected</h2>
              <p>Click a section in the preview, or pick one from the list on the left, to edit it here.</p>
              <p>Use <b className="text-fg">Design</b> to change colors, fonts and button shapes across the whole site.</p>
            </div>
          )}
        </aside>
      </div>

      {adding && <AddSection onPick={addSection} onClose={() => setAdding(false)} />}
      {publishOpen && (
        <PublishDialog
          id={id} doc={doc} live={live} suffix={addressSuffix} prefix={addressPrefix}
          onClose={() => setPublishOpen(false)}
          onDone={(r) => { setLive({ slug: r.slug, url: r.url }); setStatus("saved"); }}
        />
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded px-1 text-muted hover:text-fg disabled:opacity-30">{children}</button>;
}

function SiteRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-md px-2 py-1.5 text-left text-xs uppercase tracking-wide ${active ? "bg-accent/15 text-fg ring-1 ring-accent" : "text-muted hover:bg-bg-soft"}`}>{label}</button>;
}

function AddSection({ onPick, onClose }: { onPick: (t: string) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Add a section" className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-line bg-bg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Add a section</h2><button onClick={onClose} aria-label="Close">✕</button></div>
        {SECTION_GROUPS.map((g) => (
          <div key={g} className="mb-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{g}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <button key={s.type} onClick={() => onPick(s.type)} className="rounded-lg border border-line p-3 text-left hover:border-fg hover:bg-bg-soft">
                  <span className="block font-medium">{s.label}</span><span className="block text-xs text-muted">{s.description}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PagesPanel({ doc, commit, current, onOpen }: { doc: SiteDoc; commit: (d: SiteDoc | ((d: SiteDoc) => SiteDoc), key?: string) => void; current: string; onOpen: (id: string) => void }) {
  const add = () => {
    let n = doc.pages.length + 1, slug = `page-${n}`;
    while (doc.pages.some((p) => p.slug === slug)) slug = `page-${++n}`;
    const p: Page = { id: uid(), title: `Page ${n}`, slug, sections: [newSection("text"), newSection("cta")] };
    p.sections[0].data = { ...p.sections[0].data, heading: `Page ${n}` };
    commit({ ...doc, pages: [...doc.pages, p] });
    onOpen(p.id);
  };
  return (
    <div className="grid gap-2">
      {doc.pages.map((p, i) => {
        const clash = p.slug && doc.pages.some((o) => o.id !== p.id && o.slug === p.slug);
        return (
          <div key={p.id} className={`grid gap-1.5 rounded-md border p-2 ${p.id === current ? "border-accent" : "border-line"}`}>
            <div className="flex items-center gap-1">
              <input aria-label="Page title" className={inputCls} value={p.title} onChange={(e) => commit(mapPage(doc, p.id, (x) => ({ ...x, title: e.target.value })), `pt-${p.id}`)} />
              <IconBtn label="Open" onClick={() => onOpen(p.id)}>↗</IconBtn>
            </div>
            {p.slug === "" ? <p className="text-xs text-muted">Home page ( / )</p> : (
              <label className="flex items-center gap-1 text-xs text-muted">/<input aria-label="Page address" className={inputCls} value={p.slug} onChange={(e) => commit(mapPage(doc, p.id, (x) => ({ ...x, slug: slugify(e.target.value) || x.slug })), `ps-${p.id}`)} /></label>
            )}
            {clash && <p className="text-xs text-red-500">Another page uses this address.</p>}
            <div className="flex gap-1 text-xs">
              <IconBtn label="Move up" disabled={i === 0} onClick={() => commit({ ...doc, pages: move(doc.pages, i, -1) })}>↑</IconBtn>
              <IconBtn label="Move down" disabled={i === doc.pages.length - 1} onClick={() => commit({ ...doc, pages: move(doc.pages, i, 1) })}>↓</IconBtn>
              {p.slug !== "" && <button className="ml-auto text-red-500 hover:underline" onClick={() => { if (confirm(`Delete the page "${p.title}"?`)) { commit({ ...doc, pages: doc.pages.filter((x) => x.id !== p.id) }); if (p.id === current) onOpen(doc.pages[0].id); } }}>Delete</button>}
            </div>
          </div>
        );
      })}
      <button onClick={add} className="rounded-md border border-dashed border-line py-2 text-sm text-muted hover:border-fg hover:text-fg">+ Add page</button>
    </div>
  );
}

function DesignPanel({ doc, commit }: { doc: SiteDoc; commit: (d: SiteDoc) => void }) {
  const set = (t: Partial<SiteDoc["theme"]>) => commit({ ...doc, theme: { ...doc.theme, ...t } });
  return (
    <div className="grid gap-5">
      {/* Load every font so the font list previews itself. */}
      {FONTS.map((f) => <link key={f.id} rel="stylesheet" href={`https://fonts.googleapis.com/css2?${f.google}&display=swap`} />)}
      <div className={labelCls}>
        Colors
        <div className="grid grid-cols-2 gap-2">
          {PALETTES.map((p) => (
            <button key={p.id} onClick={() => set({ palette: p.id })} className={`rounded-md border p-2 text-left ${doc.theme.palette === p.id ? "border-fg ring-1 ring-fg" : "border-line"}`}>
              <span className="flex h-6 overflow-hidden rounded">{[p.bg, p.surface, p.accent, p.dark].map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}</span>
              <span className="mt-1 block text-xs text-fg">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={labelCls}>
        Fonts
        <div className="grid gap-1.5">
          {FONTS.map((f) => (
            <button key={f.id} onClick={() => set({ font: f.id })} className={`rounded-md border px-3 py-2 text-left ${doc.theme.font === f.id ? "border-fg ring-1 ring-fg" : "border-line"}`}>
              <span className="block text-lg text-fg" style={{ fontFamily: `"${f.heading}"`, fontWeight: f.headingWeight }}>{f.name}</span>
              <span className="block text-xs" style={{ fontFamily: `"${f.body}"` }}>{f.heading} + {f.body}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={labelCls}>
        Buttons and corners
        <div className="grid grid-cols-3 gap-1.5">
          {(["square", "soft", "round"] as const).map((s) => (
            <button key={s} onClick={() => set({ shape: s })} className={`border px-2 py-1.5 text-xs capitalize text-fg ${doc.theme.shape === s ? "border-fg ring-1 ring-fg" : "border-line"}`} style={{ borderRadius: s === "square" ? 0 : s === "soft" ? 8 : 999 }}>{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PublishDialog({ id, doc, live, suffix, prefix, onClose, onDone }: {
  id: number; doc: SiteDoc; live: { slug: string | null; url: string | null }; suffix: string; prefix: string;
  onClose: () => void; onDone: (r: Extract<PublishResult, { ok: true }>) => void;
}) {
  const [slug, setSlug] = useState(live.slug ?? slugify(doc.name));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PublishResult | null>(null);
  const go = async () => {
    setBusy(true);
    const r = await publishWebsite(id, JSON.stringify(doc), slug).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setBusy(false);
    setRes(r);
    if (r.ok) onDone(r);
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Publish" className="w-full max-w-md rounded-xl border border-line bg-bg p-6" onClick={(e) => e.stopPropagation()}>
        {res?.ok ? (
          <div className="grid gap-3 text-center">
            <p className="text-3xl">🎉</p>
            <h2 className="text-lg font-semibold">Your site is live</h2>
            <a href={res.url} target="_blank" rel="noreferrer" className="break-all text-accent underline">{res.url}</a>
            <button onClick={onClose} className="mt-2 rounded-md border border-line py-2 text-sm">Back to editing</button>
          </div>
        ) : (
          <div className="grid gap-4">
            <h2 className="text-lg font-semibold">{live.slug ? "Update your live site" : "Publish your site"}</h2>
            {live.slug ? (
              <p className="text-sm text-muted">Your latest changes will replace what&apos;s live at <a className="text-accent underline" href={live.url ?? "#"} target="_blank" rel="noreferrer">{live.url}</a>.</p>
            ) : (
              <label className={labelCls}>
                Choose your address
                <span className="flex items-center gap-1 text-sm text-fg">
                  {prefix && <span className="text-muted">{prefix}</span>}
                  <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                  {suffix && <span className="text-muted">{suffix}</span>}
                </span>
              </label>
            )}
            {res && !res.ok && (
              <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                {res.error} {res.needPlan && <Link href="/hosting" className="font-medium underline">See hosting plans</Link>}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md border border-line px-4 py-2 text-sm">Cancel</button>
              <button onClick={go} disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Publishing..." : live.slug ? "Update site" : "Publish"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
