import { NextResponse, type NextRequest } from "next/server";

const env = (k: string) => (process.env[k] || "").trim().toLowerCase();

/** Hostnames that serve this app itself (the store, dashboard, builder), not a customer site. */
function appHosts() {
  let main = "localhost";
  try { main = new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").hostname.toLowerCase(); } catch {}
  const bare = main.replace(/^www\./, "");
  const extra = env("APP_HOSTS").split(",").map((h) => h.trim()).filter(Boolean);
  return new Set([main, bare, `www.${bare}`, "localhost", ...extra]);
}

// Routes each request by its Host header:
// - <slug>.HOSTING_DOMAIN       -> that customer's site   (/hosted/<slug>/...)
// - a customer's own domain     -> /domain/<host>/..., which looks the domain up and serves its site
// - this app's own hostnames    -> the app as normal
export function middleware(req: NextRequest) {
  const domain = env("HOSTING_DOMAIN").replace(/^\.+/, "");
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0].replace(/\.$/, "");
  const path = req.nextUrl.pathname;

  if (domain && host.endsWith(`.${domain}`)) {
    const slug = host.slice(0, -(domain.length + 1));
    if (/^[a-z0-9-]+$/.test(slug)) {
      const url = req.nextUrl.clone();
      url.pathname = `/hosted/${slug}${path}`;
      return NextResponse.rewrite(url);
    }
  }

  const customDomains = !!(env("CUSTOM_DOMAIN_TARGET") || domain);
  const isIp = /^[0-9.]+$/.test(host) || host.includes("[") || host.includes(":");
  if (customDomains && host.includes(".") && !isIp && host !== domain && !appHosts().has(host)) {
    const url = req.nextUrl.clone();
    url.pathname = `/domain/${host}${path}`;
    return NextResponse.rewrite(url);
  }

  // On the app's own domain, never serve customer sites by path (only when no hosting domain is set, for local testing).
  if (path.startsWith("/domain/") || (domain && path.startsWith("/hosted/"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
