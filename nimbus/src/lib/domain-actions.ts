"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { q } from "./db";
import { normalizeDomain } from "./domain-rules";
import { checkDomain, customDomainsEnabled, reservedDomain } from "./domains";

type S = { error?: string; ok?: string } | undefined;

async function ownedSite(slug: string) {
  const user = await requireUser("/dashboard/sites");
  const site = q.siteBySlug(slug);
  return site && site.user_id === user.id ? { user, site } : null;
}

export async function connectDomain(_: S, fd: FormData): Promise<S> {
  const o = await ownedSite(String(fd.get("slug") ?? ""));
  if (!o) return { error: "Site not found." };
  if (!customDomainsEnabled()) return { error: "Custom domains aren't switched on for this server yet." };
  if (!q.activePlan(o.user.id)) return { error: "Your hosting plan is inactive." };
  if (q.domainForSite(o.site.id)) return { error: "This site already has a domain. Remove it first to use a different one." };
  const host = normalizeDomain(String(fd.get("domain") ?? ""));
  if (!host) return { error: "Enter a domain like example.com or shop.example.com." };
  if (reservedDomain(host)) return { error: "That domain can't be used." };
  const taken = q.domainByHost(host) ?? (host.startsWith("www.") ? q.domainByHost(host.slice(4)) : undefined);
  if (taken) return { error: taken.site_id === o.site.id ? "Already added." : "That domain is already connected to another site." };
  q.addDomain(o.site.id, host, crypto.randomBytes(12).toString("hex"));
  revalidatePath("/dashboard/sites");
  return { ok: "Added. Now add the DNS records below at the company where you bought the domain." };
}

export async function checkDomainNow(_: S, fd: FormData): Promise<S> {
  const user = await requireUser("/dashboard/sites");
  const d = q.domainById(Number(fd.get("id")));
  const site = d ? q.siteById(d.site_id) : undefined;
  if (!d || !site || site.user_id !== user.id) return { error: "Domain not found." };
  const r = await checkDomain(d);
  revalidatePath("/dashboard/sites");
  revalidatePath("/dashboard/websites");
  return r.ownership && r.routing ? { ok: `Connected! Your site is live at https://${d.host}` } : { error: r.error ?? "Not ready yet." };
}

export async function removeDomain(fd: FormData) {
  const user = await requireUser("/dashboard/sites");
  const d = q.domainById(Number(fd.get("id")));
  const site = d ? q.siteById(d.site_id) : undefined;
  if (!d || !site || site.user_id !== user.id) return;
  q.deleteDomain(d.id);
  revalidatePath("/dashboard/sites");
  revalidatePath("/dashboard/websites");
}
