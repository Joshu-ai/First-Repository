import { ICONS, spec } from "./sections";
import { fontPair, palette, type Data, type Link, type Page, type Section, type SiteDoc } from "./types";

// Turns a SiteDoc into plain HTML + CSS. The editor preview and the published site use the same renderer,
// so what you see while editing is exactly what goes live. Published pages need no JavaScript.

export type RenderCtx = {
  mode: "edit" | "publish";
  doc: SiteDoc;
  page: Page;
  /** Relative path from this page back to the site root, e.g. "" for home or "../" for /about/. */
  prefix: string;
  /** Maps an image value to the URL to use (publishing swaps uploaded images for files). */
  img?: (src: string) => string;
  /** Where contact forms post to. Without it, forms are shown but disabled. */
  formAction?: string;
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Only allow link targets that can't run script. Internal page links ("/about") become relative paths. */
function href(raw: string, c: RenderCtx): { href: string; page?: string } {
  const h = (raw || "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return { href: h };
  if (h.startsWith("#")) return { href: h };
  if (h.startsWith("/") && !h.startsWith("//")) {
    const [p, hash] = h.slice(1).split("#");
    const slug = p.replace(/\/+$/, "");
    const target = c.prefix + (slug ? `${slug}/` : "") + (hash ? `#${hash}` : "");
    return { href: target || "./", page: slug };
  }
  return { href: "#" };
}

/** Editable text. In edit mode it becomes contenteditable and reports changes by its data-edit path. */
function t(c: RenderCtx, s: Section | null, path: string, value: unknown, tag = "p", cls = "") {
  const v = String(value ?? "");
  if (!v.trim()) return "";
  const k = cls ? ` class="${cls}"` : "";
  if (c.mode !== "edit" || !s) return `<${tag}${k}>${esc(v)}</${tag}>`;
  return `<${tag}${k} data-edit="${esc(`${s.id}|${path}`)}" contenteditable="plaintext-only" spellcheck="true">${esc(v)}</${tag}>`;
}

function btn(c: RenderCtx, s: Section | null, path: string, l: Link | undefined, kind: "primary" | "ghost") {
  if (!l || !l.label?.trim()) return "";
  const h = href(l.href, c);
  const page = c.mode === "edit" && h.page !== undefined ? ` data-page="${esc(h.page)}"` : "";
  return `<a class="btn btn-${kind}" href="${esc(h.href)}"${page}>${t(c, s, `${path}.label`, l.label, "span")}</a>`;
}

function safeSrc(src: string) {
  return /^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,|assets\/)/i.test(src) ? src : "";
}

function img(c: RenderCtx, src: string, alt: string, cls = "") {
  const s = String(src || "");
  if (!s || s.startsWith("ph:")) {
    const n = Number(s.slice(3)) || 1;
    return `<div class="ph ph-${((n - 1) % 6) + 1} ${cls}" role="img" aria-label="${esc(alt || "Image")}"></div>`;
  }
  const url = safeSrc(c.img ? c.img(s) : s);
  if (!url) return `<div class="ph ph-1 ${cls}" role="img" aria-label="${esc(alt)}"></div>`;
  const pre = url.startsWith("assets/") ? c.prefix : "";
  return `<img class="${cls}" src="${esc(pre + url)}" alt="${esc(alt)}" loading="lazy">`;
}

const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ICONS.star}"/></svg>`;

function head(c: RenderCtx, s: Section, d: Data, center = true) {
  const h = t(c, s, "heading", d.heading, "h2", "h2") + t(c, s, "intro", d.intro, "p", "lead");
  return h ? `<div class="sec-head${center ? " center" : ""}">${t(c, s, "eyebrow", d.eyebrow, "p", "eyebrow")}${h}</div>` : "";
}

const list = (d: Data) => (Array.isArray(d.items) ? (d.items as Data[]) : []);

const R: Record<string, (c: RenderCtx, s: Section, d: Data) => string> = {
  hero(c, s, d) {
    const text = t(c, s, "eyebrow", d.eyebrow, "p", "eyebrow") + t(c, s, "heading", d.heading, "h1", "h1") + t(c, s, "text", d.text, "p", "lead");
    const btns = btn(c, s, "primary", d.primary, "primary") + btn(c, s, "secondary", d.secondary, "ghost");
    const actions = btns ? `<div class="actions">${btns}</div>` : "";
    if (d.layout === "cover")
      return `<div class="cover">${img(c, d.image, d.heading, "cover-img")}<div class="cover-shade"></div><div class="wrap cover-body">${text}${actions}</div></div>`;
    if (d.layout === "centered")
      return `<div class="wrap hero-c">${text}${actions}${d.image ? `<div class="hero-c-img">${img(c, d.image, d.heading, "r-lg")}</div>` : ""}</div>`;
    return `<div class="wrap split"><div>${text}${actions}</div><div>${img(c, d.image, d.heading, "r-lg tall")}</div></div>`;
  },
  features(c, s, d) {
    const items = list(d).map((it, i) => `<div class="card">${it.icon ? `<div class="icon">${icon(it.icon)}</div>` : ""}${t(c, s, `items.${i}.title`, it.title, "h3", "h3")}${t(c, s, `items.${i}.text`, it.text, "p", "muted")}</div>`).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="grid cols-${d.columns || 3}">${items}</div></div>`;
  },
  imageText(c, s, d) {
    const text = `<div>${t(c, s, "eyebrow", d.eyebrow, "p", "eyebrow")}${t(c, s, "heading", d.heading, "h2", "h2")}${t(c, s, "text", d.text, "div", "body")}${d.button?.label ? `<div class="actions">${btn(c, s, "button", d.button, "primary")}</div>` : ""}</div>`;
    return `<div class="wrap split${d.side === "right" ? " flip" : ""}"><div>${img(c, d.image, d.heading, "r-lg")}</div>${text}</div>`;
  },
  text(c, s, d) {
    return `<div class="wrap narrow${d.align === "center" ? " center" : ""}">${t(c, s, "heading", d.heading, "h2", "h2")}${t(c, s, "text", d.text, "div", "body")}</div>`;
  },
  gallery(c, s, d) {
    const items = list(d).map((it, i) => `<figure>${img(c, it.image, it.caption, "r-md sq")}${t(c, s, `items.${i}.caption`, it.caption, "figcaption", "muted small")}</figure>`).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="grid cols-${d.columns || 3} gallery">${items}</div></div>`;
  },
  testimonials(c, s, d) {
    const items = list(d).map((it, i) => `<figure class="card quote"><div class="qmark" aria-hidden="true">&ldquo;</div>${t(c, s, `items.${i}.quote`, it.quote, "blockquote", "")}<figcaption>${t(c, s, `items.${i}.name`, it.name, "strong", "")}${t(c, s, `items.${i}.role`, it.role, "span", "muted")}</figcaption></figure>`).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="grid cols-${Math.min(3, Math.max(1, list(d).length))}">${items}</div></div>`;
  },
  logos(c, s, d) {
    const items = list(d).map((it, i) => t(c, s, `items.${i}.name`, it.name, "span", "logo")).join("");
    return `<div class="wrap center">${t(c, s, "heading", d.heading, "p", "eyebrow")}<div class="logos">${items}</div></div>`;
  },
  stats(c, s, d) {
    const items = list(d).map((it, i) => `<div class="stat">${t(c, s, `items.${i}.value`, it.value, "div", "stat-v")}${t(c, s, `items.${i}.label`, it.label, "div", "muted")}</div>`).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="grid cols-${Math.min(4, Math.max(1, list(d).length))} stats">${items}</div></div>`;
  },
  pricing(c, s, d) {
    const items = list(d).map((it, i) => {
      const feats = String(it.features || "").split("\n").filter((x) => x.trim()).map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`).join("");
      return `<div class="card plan${it.featured ? " featured" : ""}">${t(c, s, `items.${i}.name`, it.name, "h3", "h3")}<div class="price">${t(c, s, `items.${i}.price`, it.price, "span", "price-v")}${t(c, s, `items.${i}.period`, it.period, "span", "muted")}</div>${t(c, s, `items.${i}.description`, it.description, "p", "muted")}${feats ? `<ul class="checks">${feats}</ul>` : ""}${btn(c, s, `items.${i}.button`, it.button, it.featured ? "primary" : "ghost")}</div>`;
    }).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="grid cols-${Math.min(3, Math.max(1, list(d).length))}">${items}</div></div>`;
  },
  menu(c, s, d) {
    const groups: { name: string; rows: string[] }[] = [];
    list(d).forEach((it, i) => {
      const name = String(it.category || "").trim();
      if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, rows: [] });
      groups[groups.length - 1].rows.push(`<div class="mi"><div class="mi-top">${t(c, s, `items.${i}.name`, it.name, "span", "mi-name")}<span class="dots"></span>${t(c, s, `items.${i}.price`, it.price, "span", "mi-price")}</div>${t(c, s, `items.${i}.description`, it.description, "p", "muted small")}</div>`);
    });
    const body = groups.map((g) => `<div class="mg">${g.name ? `<h3 class="h3 mg-name">${esc(g.name)}</h3>` : ""}${g.rows.join("")}</div>`).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="menu">${body}</div></div>`;
  },
  team(c, s, d) {
    const items = list(d).map((it, i) => `<div class="person">${img(c, it.image, it.name, "r-md sq")}${t(c, s, `items.${i}.name`, it.name, "h3", "h3")}${t(c, s, `items.${i}.role`, it.role, "p", "muted")}</div>`).join("");
    return `<div class="wrap">${head(c, s, d)}<div class="grid cols-${Math.min(4, Math.max(2, list(d).length))}">${items}</div></div>`;
  },
  faq(c, s, d) {
    const items = list(d).map((it, i) => `<details${c.mode === "edit" ? " open" : ""}><summary>${t(c, s, `items.${i}.q`, it.q, "span", "")}</summary>${t(c, s, `items.${i}.a`, it.a, "div", "muted body")}</details>`).join("");
    return `<div class="wrap narrow">${head(c, s, d)}<div class="faq">${items}</div></div>`;
  },
  cta(c, s, d) {
    const btns = btn(c, s, "primary", d.primary, "primary") + btn(c, s, "secondary", d.secondary, "ghost");
    return `<div class="wrap narrow center">${t(c, s, "heading", d.heading, "h2", "h2 big")}${t(c, s, "text", d.text, "p", "lead")}${btns ? `<div class="actions center">${btns}</div>` : ""}</div>`;
  },
  contact(c, s, d) {
    const row = (label: string, key: string, link?: string) =>
      d[key] ? `<div class="crow"><p class="eyebrow">${label}</p>${link ? `<a href="${esc(link)}">${t(c, s, key, d[key], "span", "")}</a>` : t(c, s, key, d[key], "div", "body")}</div>` : "";
    const info = row("Email", "email", `mailto:${d.email}`) + row("Phone", "phone", `tel:${String(d.phone || "").replace(/[^\d+]/g, "")}`) + row("Address", "address") + row("Hours", "hours");
    const dis = c.formAction ? "" : " disabled";
    const form = d.form
      ? `<form class="card form" method="post"${c.formAction ? ` action="${esc(c.formAction)}"` : ""}>
<input type="hidden" name="_page" value="${esc(c.page.slug)}"><input class="hp" type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<label>Name<input name="name" required maxlength="120"${dis}></label><label>Email<input name="email" type="email" required maxlength="200"${dis}></label>
<label>Message<textarea name="message" rows="5" required maxlength="5000"${dis}></textarea></label>
<button class="btn btn-primary" type="submit"${dis}>${esc(d.button || "Send")}</button></form>`
      : "";
    return `<div class="wrap split top"><div>${t(c, s, "heading", d.heading, "h2", "h2")}${t(c, s, "text", d.text, "p", "lead")}<div class="cinfo">${info}</div></div><div>${form}</div></div>`;
  },
};

export function renderSection(c: RenderCtx, s: Section) {
  const r = R[s.type];
  if (!r) return "";
  const id = ["contact", "pricing", "menu", "faq", "gallery", "team", "features"].includes(s.type) ? ` id="${s.type}"` : "";
  const edit = c.mode === "edit" ? ` data-section="${esc(s.id)}" data-label="${esc(spec(s.type)?.label ?? s.type)}"` : "";
  const flush = s.type === "hero" && s.data.layout === "cover" ? " flush" : "";
  const tag = c.mode === "edit" ? `<span class="nb-tag">${esc(spec(s.type)?.label ?? s.type)}</span>` : "";
  return `<section class="sec t-${s.type} tone-${s.tone || "light"}${flush}"${id}${edit}>${tag}${r(c, s, s.data)}</section>`;
}

function nav(c: RenderCtx) {
  const { doc } = c;
  const pages = doc.pages.length > 1 ? doc.pages.map((p) => {
    const h = href(`/${p.slug}`, c);
    const cur = p.id === c.page.id ? ` aria-current="page"` : "";
    return `<a href="${esc(h.href)}"${c.mode === "edit" ? ` data-page="${esc(p.slug)}"` : ""}${cur}>${esc(p.title)}</a>`;
  }).join("") : "";
  const home = href("/", c);
  const edit = c.mode === "edit" ? ` data-section="__site" data-label="Header"` : "";
  return `<header class="nav"${edit}><div class="wrap nav-in"><a class="brand" href="${esc(home.href)}"${c.mode === "edit" ? ' data-page=""' : ""}>${esc(doc.name)}</a>
<input type="checkbox" id="nb-menu" class="nb-menu" aria-label="Menu"><label for="nb-menu" class="burger" aria-hidden="true"><span></span><span></span></label>
<nav class="links">${pages}${btn(c, null, "", doc.nav?.cta, "primary")}</nav></div>${c.mode === "edit" ? '<span class="nb-tag">Header &amp; site settings</span>' : ""}</header>`;
}

function footer(c: RenderCtx) {
  const f = c.doc.footer || ({} as SiteDoc["footer"]);
  const social = (["instagram", "facebook", "linkedin"] as const).filter((k) => f[k]).map((k) => `<a href="${esc(href(f[k], c).href)}">${k[0].toUpperCase() + k.slice(1)}</a>`).join("");
  const contact = [f.email && `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>`, f.phone && `<span>${esc(f.phone)}</span>`, f.address && `<span>${esc(f.address)}</span>`].filter(Boolean).join("");
  const edit = c.mode === "edit" ? ` data-section="__footer" data-label="Footer"` : "";
  return `<footer class="foot tone-dark"${edit}><div class="wrap foot-in"><div><p class="brand">${esc(c.doc.name)}</p>${f.text ? `<p class="muted">${esc(f.text)}</p>` : ""}</div><div class="foot-col">${contact}</div><div class="foot-col">${social}</div></div>
<div class="wrap foot-base muted small"><span>&copy; ${new Date().getFullYear()} ${esc(c.doc.name)}</span><span>Made with Nimbus</span></div>${c.mode === "edit" ? '<span class="nb-tag">Footer</span>' : ""}</footer>`;
}

export function themeCss(doc: SiteDoc) {
  const p = palette(doc.theme.palette);
  const f = fontPair(doc.theme.font);
  const r = { square: ["0px", "2px", "4px"], soft: ["10px", "14px", "22px"], round: ["999px", "20px", "32px"] }[doc.theme.shape] ?? ["10px", "14px", "22px"];
  return `:root{--bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--accent:${p.accent};--on-accent:${p.onAccent};--dark:${p.dark};--on-dark:${p.onDark};--line:${p.line};
--fh:"${f.heading}",Georgia,serif;--fb:"${f.body}",system-ui,-apple-system,"Segoe UI",sans-serif;--hw:${f.headingWeight};--r-btn:${r[0]};--r-md:${r[1]};--r-lg:${r[2]}}`;
}

export const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--fb);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}a{color:inherit}h1,h2,h3,p,blockquote,figure{margin:0}
.wrap{width:100%;max-width:1160px;margin:0 auto;padding:0 24px}.narrow{max-width:780px}.center{text-align:center}
.tone-light{--b:var(--bg);--t:var(--text);--m:var(--muted);--s:var(--surface);--l:var(--line);--a:var(--accent);--oa:var(--on-accent)}
.tone-muted{--b:var(--surface);--t:var(--text);--m:var(--muted);--s:var(--bg);--l:var(--line);--a:var(--accent);--oa:var(--on-accent)}
.tone-dark{--b:var(--dark);--t:var(--on-dark);--m:color-mix(in srgb,var(--on-dark) 68%,var(--dark));--s:color-mix(in srgb,var(--on-dark) 7%,var(--dark));--l:color-mix(in srgb,var(--on-dark) 16%,var(--dark));--a:var(--accent);--oa:var(--on-accent)}
.tone-accent{--b:var(--accent);--t:var(--on-accent);--m:color-mix(in srgb,var(--on-accent) 80%,var(--accent));--s:color-mix(in srgb,var(--on-accent) 12%,var(--accent));--l:color-mix(in srgb,var(--on-accent) 25%,var(--accent));--a:var(--on-accent);--oa:var(--accent)}
.sec{background:var(--b);color:var(--t);padding:104px 0}.sec.flush{padding:0}
.h1,.h2,.h3,.brand,.stat-v,.price-v,.logo{font-family:var(--fh);font-weight:var(--hw);letter-spacing:-.02em;line-height:1.1}
.h1{font-size:clamp(2.5rem,5.4vw,4.4rem)}.h2{font-size:clamp(2rem,3.6vw,2.9rem);margin-bottom:.4em}.h2.big{font-size:clamp(2.3rem,4.6vw,3.6rem)}.h3{font-size:1.3rem;margin-bottom:.35em}
.eyebrow{font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:var(--m);margin-bottom:1rem}
.lead{font-size:1.18rem;color:var(--m);margin-top:1.1rem;max-width:40em;white-space:pre-line}.center .lead,.lead.center{margin-left:auto;margin-right:auto}
.body{white-space:pre-line;color:var(--m);margin-top:.6rem}.muted{color:var(--m)}.small{font-size:.9rem}
.sec-head{margin-bottom:52px;max-width:720px}.sec-head.center{margin-left:auto;margin-right:auto;text-align:center}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:2rem}.actions.center,.center .actions,.hero-c .actions{justify-content:center}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 26px;border-radius:var(--r-btn);font-weight:600;font-size:.98rem;text-decoration:none;border:1.5px solid transparent;transition:transform .15s,opacity .15s;cursor:pointer;font-family:inherit}
.btn:hover{transform:translateY(-1px);opacity:.92}.btn-primary{background:var(--a);color:var(--oa)}.btn-ghost{border-color:currentColor;color:var(--t);background:transparent}
.split{display:grid;grid-template-columns:1fr 1fr;gap:72px;align-items:center}.split.top{align-items:start}.split.flip>:first-child{order:2}
.hero-c{text-align:center;max-width:900px}.hero-c .lead{margin-left:auto;margin-right:auto}.hero-c-img{margin-top:64px}.hero-c-img .ph,.hero-c-img img{aspect-ratio:16/8;width:100%;object-fit:cover}
.t-hero .split .ph,.t-hero .split img{aspect-ratio:4/5;width:100%;object-fit:cover}.t-imageText .ph,.t-imageText img{aspect-ratio:5/4;width:100%;object-fit:cover}
.cover{position:relative;min-height:82vh;display:flex;align-items:flex-end;color:#fff;overflow:hidden}.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 20%,rgba(0,0,0,.62))}.cover-body{position:relative;padding-top:120px;padding-bottom:96px}
.cover .eyebrow,.cover .lead{color:rgba(255,255,255,.85)}.cover .btn-ghost{color:#fff}.cover .h1{max-width:14em}
.r-lg{border-radius:var(--r-lg)}.r-md{border-radius:var(--r-md)}.sq{aspect-ratio:1/1;width:100%;object-fit:cover}
.grid{display:grid;gap:28px}.cols-1{grid-template-columns:1fr;max-width:640px;margin:0 auto}.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}
.card{background:var(--s);border:1px solid var(--l);border-radius:var(--r-lg);padding:32px}
.icon{width:46px;height:46px;border-radius:var(--r-md);display:grid;place-items:center;background:color-mix(in srgb,var(--a) 16%,transparent);color:var(--t);margin-bottom:20px}
.gallery figure{display:grid;gap:10px}.quote blockquote{font-size:1.15rem;white-space:pre-line;margin:6px 0 22px}.qmark{font-family:var(--fh);font-size:3.4rem;line-height:.6;color:var(--a);height:24px}
.quote figcaption{display:flex;flex-direction:column}.logos{display:flex;flex-wrap:wrap;justify-content:center;gap:28px 56px;margin-top:8px}.logo{font-size:1.5rem;color:var(--m)}
.t-logos{padding:64px 0}.stats{text-align:center}.stat-v{font-size:clamp(2.4rem,4.4vw,3.4rem);color:var(--t)}.t-stats{padding:80px 0}
.plan{display:flex;flex-direction:column;gap:6px}.plan .btn{margin-top:auto}.plan.featured{border:2px solid var(--a);box-shadow:0 20px 50px -24px color-mix(in srgb,var(--a) 60%,transparent)}
.price{display:flex;align-items:baseline;gap:4px;margin:6px 0}.price-v{font-size:2.6rem}.checks{list-style:none;padding:0;margin:14px 0 26px;display:grid;gap:10px}
.checks li{display:flex;gap:10px;align-items:flex-start}.checks svg{flex:none;width:18px;height:18px;margin-top:4px;color:var(--t)}
.menu{display:grid;grid-template-columns:repeat(2,1fr);gap:28px 72px}.mg-name{margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid var(--l)}.mi{margin-bottom:22px}
.mi-top{display:flex;align-items:baseline;gap:10px;font-weight:600;font-size:1.05rem}.dots{flex:1;border-bottom:1.5px dotted var(--l);transform:translateY(-4px)}
.person .sq{margin-bottom:16px}.person .h3{margin-bottom:2px}
.faq details{border-bottom:1px solid var(--l);padding:20px 0}.faq summary{cursor:pointer;font-weight:600;font-size:1.1rem;list-style:none;display:flex;justify-content:space-between;gap:16px}
.faq summary::-webkit-details-marker{display:none}.faq summary::after{content:"+";font-size:1.4rem;line-height:1;color:var(--m)}.faq details[open] summary::after{content:"\\2013"}
.cinfo{display:grid;gap:22px;margin-top:36px}.crow .eyebrow{margin-bottom:4px}.crow a{text-decoration:none;font-size:1.1rem;font-weight:500}.crow .body{margin:0;color:var(--t)}
.form{display:grid;gap:16px}.form label{display:grid;gap:6px;font-size:.9rem;font-weight:600}.form input,.form textarea{font:inherit;font-weight:400;color:var(--t);background:var(--b);border:1px solid var(--l);border-radius:var(--r-md);padding:12px 14px;width:100%}
.form textarea{resize:vertical}.form .btn{justify-self:start}.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.nav{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line);color:var(--text)}
.nav-in{display:flex;align-items:center;gap:24px;min-height:72px}.brand{font-size:1.35rem;text-decoration:none}.links{margin-left:auto;display:flex;align-items:center;gap:28px}
.links a{text-decoration:none;font-size:.96rem}.links a:not(.btn){color:var(--muted)}.links a[aria-current]{color:var(--text)}.links .btn{min-height:42px;padding:0 20px;--a:var(--accent);--oa:var(--on-accent)}
.nb-menu,.burger{display:none}
.foot{background:var(--b);color:var(--t);padding:72px 0 32px}.foot-in{display:grid;grid-template-columns:2fr 1fr 1fr;gap:40px}.foot-col{display:grid;gap:8px;align-content:start}
.foot a{text-decoration:none}.foot .brand{margin-bottom:10px}.foot-base{display:flex;justify-content:space-between;gap:16px;margin-top:56px;padding-top:24px;border-top:1px solid var(--l)}
.ph{width:100%;aspect-ratio:4/3;position:relative;overflow:hidden;background:var(--surface)}
.ph-1{background:radial-gradient(circle at 70% 30%,color-mix(in srgb,var(--accent) 75%,#fff) 0 18%,transparent 19%),linear-gradient(160deg,color-mix(in srgb,var(--accent) 35%,var(--surface)),color-mix(in srgb,var(--dark) 55%,var(--accent)))}
.ph-2{background:radial-gradient(ellipse 80% 50% at 50% 110%,color-mix(in srgb,var(--dark) 70%,var(--accent)) 0 60%,transparent 61%),radial-gradient(circle at 30% 35%,color-mix(in srgb,var(--accent) 50%,#fff) 0 14%,transparent 15%),linear-gradient(var(--surface),color-mix(in srgb,var(--accent) 22%,var(--surface)))}
.ph-3{background:linear-gradient(115deg,transparent 0 48%,color-mix(in srgb,var(--accent) 60%,var(--dark)) 48% 100%),linear-gradient(200deg,color-mix(in srgb,var(--accent) 30%,#fff),color-mix(in srgb,var(--surface) 80%,var(--accent)))}
.ph-4{background:radial-gradient(circle at 50% 38%,color-mix(in srgb,var(--dark) 45%,var(--surface)) 0 17%,transparent 18%),radial-gradient(ellipse 40% 30% at 50% 92%,color-mix(in srgb,var(--dark) 45%,var(--surface)) 0 99%,transparent 100%),color-mix(in srgb,var(--accent) 18%,var(--surface))}
.ph-5{background:radial-gradient(circle at 50% 38%,color-mix(in srgb,var(--accent) 55%,var(--dark)) 0 17%,transparent 18%),radial-gradient(ellipse 40% 30% at 50% 92%,color-mix(in srgb,var(--accent) 55%,var(--dark)) 0 99%,transparent 100%),color-mix(in srgb,var(--surface) 70%,#fff)}
.ph-6{background:conic-gradient(from 210deg at 30% 70%,color-mix(in srgb,var(--accent) 70%,var(--dark)),color-mix(in srgb,var(--accent) 25%,var(--surface)),color-mix(in srgb,var(--dark) 40%,var(--accent)),color-mix(in srgb,var(--accent) 70%,var(--dark)))}
.cover .ph{position:absolute;inset:0;height:100%;aspect-ratio:auto}
@media (max-width:900px){.split{grid-template-columns:1fr;gap:44px}.split.flip>:first-child{order:0}.cols-3,.cols-4{grid-template-columns:repeat(2,1fr)}.menu{grid-template-columns:1fr}.foot-in{grid-template-columns:1fr 1fr}.foot-in>:first-child{grid-column:1/-1}}
@media (max-width:640px){body{font-size:16px}.sec{padding:72px 0}.cols-2,.cols-3,.cols-4{grid-template-columns:1fr}.gallery.cols-3,.gallery.cols-4{grid-template-columns:repeat(2,1fr);gap:14px}.card{padding:24px}
.burger{display:grid;gap:6px;margin-left:auto;cursor:pointer;padding:10px}.burger span{display:block;width:22px;height:2px;background:currentColor}
.links{display:none;position:absolute;top:100%;left:0;right:0;flex-direction:column;align-items:flex-start;gap:16px;padding:20px 24px 28px;background:var(--bg);border-bottom:1px solid var(--line)}
.nb-menu:checked~.links{display:flex}.foot-in{grid-template-columns:1fr}.foot-base{flex-direction:column}.cover{min-height:72vh}}`;

// Outlines and labels shown only inside the editor preview.
export const EDIT_CSS = `[data-section]:not(.nav){position:relative}[data-section]{cursor:pointer}[data-section]:hover{box-shadow:inset 0 0 0 2px rgba(79,124,255,.55)}
[data-section].nb-sel{box-shadow:inset 0 0 0 2px #4f7cff}
[data-section]:hover>.nb-tag,[data-section].nb-sel>.nb-tag{display:block}
.nb-tag{display:none;position:absolute;top:8px;left:8px;z-index:30;background:#4f7cff;color:#fff;font:600 11px/1 system-ui;padding:5px 8px;border-radius:4px;pointer-events:none;letter-spacing:.02em}
header.nav>.nb-tag{top:auto;bottom:-24px}
[contenteditable]{outline:none;border-radius:3px;cursor:text}[contenteditable]:hover{box-shadow:0 0 0 1px rgba(79,124,255,.5)}[contenteditable]:focus{box-shadow:0 0 0 2px #4f7cff;background:rgba(79,124,255,.06)}
.btn [contenteditable]:focus{background:transparent}`;

export function fontsHref(doc: SiteDoc) {
  return `https://fonts.googleapis.com/css2?${fontPair(doc.theme.font).google}&display=swap`;
}

/** Inner HTML of <body>. The editor swaps this in place so the preview doesn't flash on every keystroke. */
export function renderBody(c: RenderCtx) {
  return nav(c) + `<main>${c.page.sections.map((s) => renderSection(c, s)).join("")}</main>` + footer(c);
}

export function renderPage(c: RenderCtx) {
  const { doc, page } = c;
  const title = page.slug ? `${page.title} | ${doc.name}` : doc.name;
  const hero = page.sections.find((s) => s.data.text);
  const desc = hero ? String(hero.data.text).slice(0, 160) : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ""}<meta property="og:title" content="${esc(title)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link id="nb-font" rel="stylesheet" href="${esc(fontsHref(doc))}">
<style id="nb-theme">${themeCss(doc)}</style><style>${BASE_CSS}</style>${c.mode === "edit" ? `<style>${EDIT_CSS}</style>` : ""}
</head><body>${renderBody(c)}</body></html>`;
}

/** The URL path of a page relative to the site root, and the matching prefix back to the root. */
export const pagePath = (p: Page) => (p.slug ? `${p.slug}/index.html` : "index.html");
export const pagePrefix = (p: Page) => (p.slug ? "../" : "");
