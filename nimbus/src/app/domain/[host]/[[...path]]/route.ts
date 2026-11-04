import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isApex } from "@/lib/domain-rules";
import { serveSite, sitePage } from "@/lib/serve-site";

// Requests to a customer's own domain land here (see src/middleware.ts).
export async function GET(req: Request, { params }: { params: Promise<{ host: string; path?: string[] }> }) {
  const { host, path: parts = [] } = await params;
  const d = q.domainByHost(host);
  if (d?.status === "active") {
    const site = q.siteById(d.site_id);
    if (site) return serveSite(site.slug, parts, null);
  }
  // www.example.com -> example.com, when example.com is connected.
  if (!d && host.startsWith("www.")) {
    const apex = host.slice(4);
    const root = q.domainByHost(apex);
    if (root?.status === "active" && isApex(apex)) {
      const u = new URL(req.url);
      return NextResponse.redirect(`https://${apex}/${parts.map(encodeURIComponent).join("/")}${u.search}`, 301);
    }
  }
  return sitePage(404, "Domain not connected", "This domain isn't connected to a site yet. If it's yours, finish the setup in your dashboard.");
}
