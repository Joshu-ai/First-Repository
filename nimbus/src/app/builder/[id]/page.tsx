import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { siteUrl } from "@/lib/brand";
import { q } from "@/lib/db";
import { hostingDomain, siteLiveUrl } from "@/lib/hosting";
import type { SiteDoc } from "@/lib/builder/types";
import Editor from "./Editor";

export const metadata = { title: "Editor" };

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/builder/${id}`);
  const b = q.builderSite(Number(id));
  if (!b || b.user_id !== user.id) notFound();
  const site = b.site_id ? q.siteById(b.site_id) : undefined;
  const d = hostingDomain();
  return (
    <Editor
      id={b.id}
      initial={JSON.parse(b.doc) as SiteDoc}
      publishedSlug={site?.slug ?? null}
      liveUrl={site ? siteLiveUrl(site.slug) : null}
      addressPrefix={d ? "https://" : `${siteUrl().replace(/^https?:\/\//, "")}/hosted/`}
      addressSuffix={d ? `.${d}` : ""}
    />
  );
}
