import { zipSync, strToU8 } from "fflate";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { buildSiteFiles } from "@/lib/builder/publish";
import { slugify, type SiteDoc } from "@/lib/builder/types";

// Downloads a builder site as a .zip of static HTML that can be hosted anywhere.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const b = q.builderSite(Number((await params).id));
  if (!user || !b || b.user_id !== user.id) return new Response("Not found", { status: 404 });
  const files = buildSiteFiles(JSON.parse(b.doc) as SiteDoc, b.id);
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
  return new Response(new Uint8Array(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slugify(b.name) || "site"}.zip"` },
  });
}
