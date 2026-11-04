import { spec } from "./sections";
import { uid, type Data, type Page, type Section, type SiteDoc } from "./types";

// Immutable helpers the editor uses to change a SiteDoc. Each returns a new object and leaves the input untouched.

export function setIn<T>(obj: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const src = (obj ?? (typeof k === "number" ? [] : {})) as any;
  const copy = Array.isArray(src) ? [...src] : { ...src };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (copy as any)[k] = setIn(src[k], rest, value);
  return copy as T;
}

export const parsePath = (p: string) => p.split(".").filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x));

export const mapPage = (doc: SiteDoc, pageId: string, fn: (p: Page) => Page): SiteDoc =>
  ({ ...doc, pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) });

export const mapSection = (doc: SiteDoc, secId: string, fn: (s: Section) => Section): SiteDoc =>
  ({ ...doc, pages: doc.pages.map((p) => (p.sections.some((s) => s.id === secId) ? { ...p, sections: p.sections.map((s) => (s.id === secId ? fn(s) : s)) } : p)) });

export const setField = (doc: SiteDoc, secId: string, path: string, value: unknown) =>
  mapSection(doc, secId, (s) => ({ ...s, data: setIn<Data>(s.data, parsePath(path), value) }));

export function newSection(type: string): Section {
  return { id: uid(), type, tone: "light", data: structuredClone(spec(type)!.defaults) };
}

export const cloneSection = (s: Section): Section => ({ ...structuredClone(s), id: uid() });

export function move<T>(arr: T[], i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function findSection(doc: SiteDoc, id: string) {
  for (const p of doc.pages) for (const s of p.sections) if (s.id === id) return s;
  return undefined;
}
