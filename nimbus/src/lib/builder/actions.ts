"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireUser } from "../auth";
import { q } from "../db";
import { deployFiles, removeSiteFiles, siteLiveUrl } from "../hosting";
import { buildSiteFiles, checkDoc, docSizeOk } from "./publish";
import { template } from "./templates";
import { slugify, type SiteDoc } from "./types";

const RESERVED = new Set(["www", "app", "api", "admin", "mail", "hosted", "static", "assets"]);

async function own(id: number) {
  const user = await currentUser();
  const b = q.builderSite(id);
  if (!user || !b || b.user_id !== user.id) return null;
  return { user, b };
}

export async function createWebsite(fd: FormData) {
  const t = template(String(fd.get("template") ?? ""));
  if (!t) redirect("/builder");
  const user = await requireUser(`/builder?start=${t.id}`);
  const doc = t.doc();
  const id = q.createBuilderSite(user.id, doc.name, t.id, JSON.stringify(doc));
  redirect(`/builder/${id}`);
}

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

export async function saveWebsite(id: number, json: string): Promise<SaveResult> {
  const o = await own(id);
  if (!o) return { ok: false, error: "You're signed out. Log in again to keep saving." };
  if (!docSizeOk(json)) return { ok: false, error: "This site is too large to save. Try smaller images." };
  let doc: SiteDoc;
  try { doc = JSON.parse(json); } catch { return { ok: false, error: "Couldn't read the site." }; }
  const err = checkDoc(doc);
  if (err) return { ok: false, error: err };
  q.saveBuilderSite(id, doc.name.slice(0, 80) || "Untitled site", json);
  return { ok: true, savedAt: new Date().toISOString() };
}

export type PublishResult = { ok: true; url: string; slug: string } | { ok: false; error: string; needPlan?: boolean };

export async function publishWebsite(id: number, json: string, wantedSlug?: string): Promise<PublishResult> {
  const saved = await saveWebsite(id, json);
  if (!saved.ok) return saved;
  const o = (await own(id))!;
  const { user, b } = o;
  const plan = q.activePlan(user.id);
  if (!plan) return { ok: false, needPlan: true, error: "Publishing needs a hosting plan. Pick one and come back to go live." };

  let site = b.site_id ? q.siteById(b.site_id) : undefined;
  if (!site) {
    const slug = slugify(wantedSlug || b.name);
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return { ok: false, error: "Address must be 3-40 characters: lowercase letters, numbers and dashes." };
    if (RESERVED.has(slug) || q.siteBySlug(slug)) return { ok: false, error: `"${slug}" is taken. Try another address.` };
    if (q.sitesForUser(user.id).length >= plan.plan_sites)
      return { ok: false, needPlan: true, error: `Your ${plan.name} plan allows ${plan.plan_sites} site${plan.plan_sites === 1 ? "" : "s"}. Upgrade to publish another.` };
    q.createSite(user.id, slug, b.name);
    site = q.siteBySlug(slug)!;
  }
  try {
    const r = deployFiles(site.slug, buildSiteFiles(JSON.parse(json), id));
    q.markDeployed(site.id, r.files, r.bytes);
    q.markBuilderPublished(id, site.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Publishing failed." };
  }
  revalidatePath("/dashboard/websites");
  return { ok: true, url: siteLiveUrl(site.slug), slug: site.slug };
}

export async function deleteWebsite(fd: FormData) {
  const o = await own(Number(fd.get("id")));
  if (!o) return;
  if (o.b.site_id && fd.get("unpublish") === "1") {
    const site = q.siteById(o.b.site_id);
    if (site && site.user_id === o.user.id) { removeSiteFiles(site.slug); q.deleteSite(site.id); }
  }
  q.deleteBuilderSite(o.b.id);
  revalidatePath("/dashboard/websites");
}
