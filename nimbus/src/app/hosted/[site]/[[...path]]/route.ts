import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { hostingDomain } from "@/lib/hosting";
import { serveSite } from "@/lib/serve-site";

export async function GET(req: Request, { params }: { params: Promise<{ site: string; path?: string[] }> }) {
  const { site, path: parts = [] } = await params;
  // A site with a connected custom domain redirects its default address there, so visitors and search engines
  // see one address.
  if (hostingDomain()) {
    const custom = q.activeDomainForSlug(site);
    if (custom) {
      const u = new URL(req.url);
      return NextResponse.redirect(`https://${custom.host}/${parts.map(encodeURIComponent).join("/")}${u.search}`, 301);
    }
  }
  // Without a hosting domain, sites are served under /hosted/<slug>/.
  return serveSite(site, parts, hostingDomain() ? null : `/hosted/${site}/`);
}
