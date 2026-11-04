import "server-only";
import fs from "node:fs";
import path from "node:path";
import { brand, siteUrl } from "./brand";
import { DATA_DIR } from "./db";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Where new-order and new-message alerts go. */
export const adminInbox = () =>
  (process.env.ADMIN_NOTIFY_EMAIL || (process.env.ADMIN_EMAILS || "").split(",")[0] || "").trim();

type Mail = { to: string; subject: string; heading: string; lines: string[]; button?: { label: string; href: string } };

function render(m: Mail) {
  const btn = m.button
    ? `<p style="margin:28px 0"><a href="${esc(m.button.href)}" style="background:#000;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">${esc(m.button.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #eaeaea;border-radius:10px;padding:32px">
<p style="font-weight:700;font-size:18px;margin:0 0 24px">${esc(brand.name)}</p>
<h1 style="font-size:22px;margin:0 0 16px">${esc(m.heading)}</h1>
${m.lines.map((l) => `<p style="line-height:1.6;color:#444;margin:0 0 12px;white-space:pre-wrap">${esc(l)}</p>`).join("")}
${btn}</div>
<p style="color:#888;font-size:12px;text-align:center;margin-top:16px">Questions? Reply to this email or write to ${esc(brand.supportEmail)}.</p></div></body></html>`;
  const text = [m.heading, "", ...m.lines, ...(m.button ? ["", `${m.button.label}: ${m.button.href}`] : [])].join("\n");
  return { html, text };
}

/**
 * Sends an email through Resend when RESEND_API_KEY is set.
 * Otherwise it's written to DATA_DIR/outbox so you can read it during development.
 * Never throws: a failed email must not break a purchase.
 */
export async function sendEmail(m: Mail) {
  if (!m.to) return;
  const { html, text } = render(m);
  try {
    if (process.env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || `${brand.name} <onboarding@resend.dev>`,
          to: [m.to], subject: m.subject, html, text, reply_to: brand.supportEmail,
        }),
      });
      if (!r.ok) console.error("[email] send failed", r.status, await r.text());
      return;
    }
    const dir = path.join(DATA_DIR, "outbox");
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${m.to.replace(/[^a-z0-9@.]/gi, "_")}.html`;
    fs.writeFileSync(path.join(dir, name), `<!-- To: ${m.to} | Subject: ${m.subject} -->\n${html}`);
    console.log(`[email:dev] to=${m.to} subject="${m.subject}" -> data/outbox/${name}`);
  } catch (e) {
    console.error("[email] error", e);
  }
}

export const link = (p: string) => `${siteUrl()}${p}`;
