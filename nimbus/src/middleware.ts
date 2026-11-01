import { NextResponse, type NextRequest } from "next/server";

// When HOSTING_DOMAIN is set (e.g. "mysites.app" with a wildcard DNS record *.mysites.app),
// requests to <slug>.mysites.app are served from the customer's uploaded site.
export function middleware(req: NextRequest) {
  const domain = (process.env.HOSTING_DOMAIN || "").toLowerCase();
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (domain && host.endsWith(`.${domain}`)) {
    const slug = host.slice(0, -(domain.length + 1));
    if (/^[a-z0-9-]+$/.test(slug)) {
      const url = req.nextUrl.clone();
      url.pathname = `/hosted/${slug}${req.nextUrl.pathname}`;
      return NextResponse.rewrite(url);
    }
  }
  // On the main domain, only serve /hosted/* when no hosting domain is configured (local testing).
  if (domain && req.nextUrl.pathname.startsWith("/hosted/") && !host.endsWith(`.${domain}`)) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
