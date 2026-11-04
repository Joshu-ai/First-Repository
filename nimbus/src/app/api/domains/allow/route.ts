import { q } from "@/lib/db";
import { isApex, normalizeDomain, within } from "@/lib/domain-rules";
import { hostingDomain } from "@/lib/hosting";
import { siteUrl } from "@/lib/brand";

/**
 * Asked by the TLS proxy (Caddy's on_demand_tls "ask") before it requests a certificate for a hostname.
 * 200 = go ahead, anything else = refuse. This stops strangers from making us request certificates for
 * arbitrary domains that happen to point here.
 */
export async function GET(req: Request) {
  const host = normalizeDomain(new URL(req.url).searchParams.get("domain") || "");
  if (!host) return new Response("bad domain", { status: 400 });
  return allowed(host) ? new Response("ok") : new Response("no", { status: 404 });
}

function allowed(host: string) {
  const main = new URL(siteUrl()).hostname.toLowerCase();
  if (host === main || host === `www.${main}` || `www.${host}` === main) return true;
  const hd = hostingDomain();
  if (hd && within(host, hd) && host !== hd) {
    const slug = host.slice(0, -(hd.length + 1));
    return slug === "cname" || !!q.siteBySlug(slug);
  }
  if (q.domainByHost(host)?.status === "active") return true;
  if (host.startsWith("www.")) {
    const apex = host.slice(4);
    return isApex(apex) && q.domainByHost(apex)?.status === "active";
  }
  return false;
}
