import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { unzipSync } from "fflate";
import * as tar from "tar";
import { DATA_DIR } from "./db";

export const SITES_DIR = path.join(DATA_DIR, "sites");
const MAX_FILES = 5000;
const MAX_BYTES = 200 * 1024 * 1024;

export const hostingDomain = () => (process.env.HOSTING_DOMAIN || "").toLowerCase().replace(/^\.+/, "");

/** Public URL for a hosted site. Uses <slug>.HOSTING_DOMAIN in production, a path locally. */
export function siteLiveUrl(slug: string) {
  const d = hostingDomain();
  if (d) return `https://${slug}.${d}/`;
  return `${(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "")}/hosted/${slug}/`;
}

export const siteRoot = (slug: string) => path.join(SITES_DIR, slug, "current");

function safeRel(name: string) {
  const n = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!n || n.startsWith("/") || n.split("/").some((p) => p === ".." ) || /^[a-zA-Z]:/.test(n)) return null;
  return n;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Extracts an uploaded .zip or .tar.gz build and atomically swaps it in as the live version. */
export async function deployArchive(slug: string, fileName: string, data: Buffer) {
  const base = path.join(SITES_DIR, slug);
  const stage = path.join(base, `stage-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    if (/\.zip$/i.test(fileName)) {
      const entries = unzipSync(new Uint8Array(data));
      const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
      if (names.length > MAX_FILES) throw new Error(`Too many files (max ${MAX_FILES}).`);
      let total = 0;
      for (const n of names) {
        const rel = safeRel(n);
        if (!rel) throw new Error(`Unsafe path in archive: ${n}`);
        total += entries[n].length;
        if (total > MAX_BYTES) throw new Error("Site is too large (max 200 MB unpacked).");
        const out = path.join(stage, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, entries[n]);
      }
    } else if (/\.(tar\.gz|tgz)$/i.test(fileName)) {
      const tmp = path.join(base, `upload-${crypto.randomBytes(4).toString("hex")}.tgz`);
      fs.writeFileSync(tmp, data);
      let count = 0, total = 0, bad = "";
      try {
        await tar.x({
          file: tmp, cwd: stage, strict: true,
          filter: (p, entry) => {
            const e = entry as tar.ReadEntry;
            if (e.type !== "File" && e.type !== "Directory") return false; // no symlinks/devices
            if (!safeRel(p)) { bad = p; return false; }
            if (e.type === "File") { count++; total += e.size ?? 0; }
            return count <= MAX_FILES && total <= MAX_BYTES;
          },
        });
      } finally { fs.rmSync(tmp, { force: true }); }
      if (bad) throw new Error(`Unsafe path in archive: ${bad}`);
      if (count > MAX_FILES) throw new Error(`Too many files (max ${MAX_FILES}).`);
      if (total > MAX_BYTES) throw new Error("Site is too large (max 200 MB unpacked).");
    } else {
      throw new Error("Upload a .zip or .tar.gz of your built site.");
    }

    // If everything sits in one folder (e.g. "out/" or "dist/"), serve that folder.
    let root = stage;
    for (;;) {
      const items = fs.readdirSync(root).filter((n) => n !== "__MACOSX" && n !== ".DS_Store");
      if (items.length === 1 && fs.statSync(path.join(root, items[0])).isDirectory()) root = path.join(root, items[0]);
      else break;
    }
    if (!fs.existsSync(path.join(root, "index.html"))) throw new Error("No index.html found. Upload your built site (e.g. the out/ or dist/ folder).");

    const files = walk(root);
    const bytes = files.reduce((s, f) => s + fs.statSync(f).size, 0);
    const live = path.join(base, "current");
    const old = path.join(base, `old-${Date.now()}`);
    if (fs.existsSync(live)) fs.renameSync(live, old);
    fs.renameSync(root, live);
    fs.rmSync(old, { recursive: true, force: true });
    return { files: files.length, bytes };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export function removeSiteFiles(slug: string) {
  fs.rmSync(path.join(SITES_DIR, slug), { recursive: true, force: true });
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".wasm": "application/wasm",
  ".map": "application/json", ".webmanifest": "application/manifest+json",
};

/** Finds the file to serve for a URL path, trying index.html and .html like most static hosts. */
export function resolveFile(slug: string, parts: string[]): { file: string; status: number } | null {
  const root = siteRoot(slug);
  if (!fs.existsSync(root)) return null;
  const rel = parts.map((p) => decodeURIComponent(p)).join("/");
  if (rel.split("/").some((p) => p === ".." || p.includes("\0"))) return null;
  const cands = [rel, path.posix.join(rel, "index.html"), `${rel}.html`];
  for (const c of cands) {
    const f = path.join(root, c);
    if (!f.startsWith(root)) continue;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return { file: f, status: 200 };
  }
  const nf = path.join(root, "404.html");
  if (fs.existsSync(nf)) return { file: nf, status: 404 };
  return null;
}

export const contentType = (f: string) => TYPES[path.extname(f).toLowerCase()] ?? "application/octet-stream";
