import "server-only";
import crypto from "node:crypto";
import { siteUrl } from "../brand";
import { pagePath, pagePrefix, renderPage } from "./render";
import { spec } from "./sections";
import type { SiteDoc } from "./types";

const MAX_DOC = 40 * 1024 * 1024;

/** Checks that a document from the browser has the shape the renderer expects. Returns an error message or null. */
export function checkDoc(raw: unknown): string | null {
  const d = raw as SiteDoc;
  if (!d || typeof d !== "object" || d.v !== 1) return "Invalid site.";
  if (typeof d.name !== "string" || !d.theme || !Array.isArray(d.pages) || !d.pages.length) return "Invalid site.";
  if (d.pages.length > 30) return "A site can have up to 30 pages.";
  const slugs = new Set<string>();
  for (const p of d.pages) {
    if (typeof p.slug !== "string" || !/^[a-z0-9-]{0,40}$/.test(p.slug)) return `Page address "${p.slug}" is not valid.`;
    if (slugs.has(p.slug)) return `Two pages use the address "/${p.slug}".`;
    slugs.add(p.slug);
    if (!Array.isArray(p.sections) || p.sections.length > 60) return "Too many sections on a page.";
    for (const s of p.sections) if (!s || typeof s.id !== "string" || !spec(s.type) || typeof s.data !== "object") return "Invalid section.";
  }
  if (!slugs.has("")) return "Your site needs a home page.";
  return null;
}

export function docSizeOk(json: string) {
  return json.length <= MAX_DOC;
}

/** Renders every page of a site to static files. Uploaded images are written out as separate files. */
export function buildSiteFiles(doc: SiteDoc, builderId: number) {
  const files: Record<string, string | Uint8Array> = {};
  const assets = new Map<string, string>();
  const img = (src: string) => {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(src);
    if (!m) return src;
    const hit = assets.get(src);
    if (hit) return hit;
    const bytes = Buffer.from(m[2], "base64");
    const name = `assets/${crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 16)}.${m[1].toLowerCase().replace("jpeg", "jpg")}`;
    files[name] = bytes;
    assets.set(src, name);
    return name;
  };
  const formAction = `${siteUrl()}/api/forms/${builderId}`;
  for (const page of doc.pages) {
    files[pagePath(page)] = renderPage({ mode: "publish", doc, page, prefix: pagePrefix(page), img, formAction });
  }
  return files;
}
