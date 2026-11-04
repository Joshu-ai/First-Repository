import { pagePrefix, renderPage } from "@/lib/builder/render";
import { template } from "@/lib/builder/templates";

// A live preview of a starter template, used by the gallery. Links between pages keep working.
export async function GET(req: Request, { params }: { params: Promise<{ template: string }> }) {
  const t = template((await params).template);
  if (!t) return new Response("Not found", { status: 404 });
  const doc = t.doc();
  const slug = new URL(req.url).searchParams.get("page") ?? "";
  const page = doc.pages.find((p) => p.slug === slug) ?? doc.pages[0];
  let html = renderPage({ mode: "publish", doc, page, prefix: pagePrefix(page) });
  // Rewrite relative page links into ?page= links on this route.
  html = html.replace(/href="((?:\.\.\/)?)([a-z0-9-]*)\/?(#[^"]*)?"/g, (m, _up, s, hash) =>
    s || _up || m === 'href="./"' ? `href="?page=${s}${hash ?? ""}"` : m).replace(/href="\.\/"/g, 'href="?page="');
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-same-origin allow-popups" } });
}
