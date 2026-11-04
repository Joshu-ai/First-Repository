import fs from "node:fs";
import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { contentType, hostingDomain, resolveFile } from "@/lib/hosting";

// Customer sites run in a sandbox so their scripts can never act as your store's logged-in users.
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";

function page(status: number, title: string, text: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;margin:0;color:#333"><div style="text-align:center"><h1>${title}</h1><p>${text}</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": SANDBOX } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ site: string; path?: string[] }> }) {
  const { site, path: parts = [] } = await params;
  const s = q.siteBySlug(site);
  if (!s || !s.deployed_at) return page(404, "Site not found", "There's nothing deployed here yet.");
  if (!q.activePlan(s.user_id)) return page(402, "Site paused", "This site's hosting plan is inactive.");

  const hit = resolveFile(site, parts);
  if (!hit) return page(404, "Page not found", "This page doesn't exist on this site.");
  let body: Buffer | string = fs.readFileSync(hit.file);
  const isHtml = hit.file.endsWith(".html") || hit.file.endsWith(".htm");
  // Without a hosting domain, sites are served under /hosted/<slug>/. A <base> tag keeps their relative links working.
  if (isHtml && !hostingDomain()) {
    const rel = hit.file.slice(hit.file.indexOf("/current/") + "/current/".length);
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
    const tag = `<base href="/hosted/${site}/${dir}">`;
    const html = body.toString("utf8");
    body = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
  }
  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
    status: hit.status,
    headers: {
      "content-type": contentType(hit.file),
      "cache-control": isHtml ? "public, max-age=0, must-revalidate" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
      ...(isHtml || hit.file.endsWith(".svg") ? { "content-security-policy": SANDBOX } : {}),
    },
  });
}
