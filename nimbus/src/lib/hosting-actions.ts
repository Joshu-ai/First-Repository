"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { q } from "./db";
import { deployArchive, removeSiteFiles } from "./hosting";

type S = { error?: string; ok?: string } | undefined;
const RESERVED = new Set(["www", "app", "api", "admin", "mail", "hosted", "static", "assets"]);

export async function createSite(_: S, fd: FormData): Promise<S> {
  const user = await requireUser("/dashboard/sites");
  const plan = q.activePlan(user.id);
  if (!plan) return { error: "Choose a hosting plan first." };
  if (q.sitesForUser(user.id).length >= plan.plan_sites) return { error: `Your ${plan.name} plan allows ${plan.plan_sites} site${plan.plan_sites === 1 ? "" : "s"}. Upgrade to add more.` };
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const slug = String(fd.get("slug") ?? "").trim().toLowerCase();
  if (!name) return { error: "Give your site a name." };
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return { error: "Address must be 3-40 characters: lowercase letters, numbers and dashes." };
  if (RESERVED.has(slug) || q.siteBySlug(slug)) return { error: "That address is taken. Try another." };
  q.createSite(user.id, slug, name);
  revalidatePath("/dashboard/sites");
  return { ok: "Site created. Now upload your build." };
}

export async function deploySite(_: S, fd: FormData): Promise<S> {
  const user = await requireUser("/dashboard/sites");
  const site = q.siteBySlug(String(fd.get("slug") ?? ""));
  if (!site || site.user_id !== user.id) return { error: "Site not found." };
  if (!q.activePlan(user.id)) return { error: "Your hosting plan is inactive." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .zip or .tar.gz file." };
  try {
    const r = await deployArchive(site.slug, file.name, Buffer.from(await file.arrayBuffer()));
    q.markDeployed(site.id, r.files, r.bytes);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Deploy failed." };
  }
  revalidatePath("/dashboard/sites");
  return { ok: "Deployed! Your site is live." };
}

export async function deleteSite(fd: FormData) {
  const user = await requireUser("/dashboard/sites");
  const site = q.siteBySlug(String(fd.get("slug") ?? ""));
  if (!site || site.user_id !== user.id) return;
  removeSiteFiles(site.slug);
  q.deleteSite(site.id);
  revalidatePath("/dashboard/sites");
}
