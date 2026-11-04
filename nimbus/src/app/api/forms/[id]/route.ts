import { q } from "@/lib/db";
import { link, sendEmail } from "@/lib/email";
import { esc } from "@/lib/builder/render";

// Contact forms on published builder sites post here. Submissions are saved and emailed to the site owner.

function page(title: string, text: string, back: string | null, status = 200) {
  const b = back ? `<p><a href="${esc(back)}" style="color:inherit">Back to the site</a></p>` : "";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;margin:0;color:#222;background:#fafafa"><div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:28px">${esc(title)}</h1><p style="color:#555">${esc(text)}</p>${b}</div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = q.builderSite(id);
  const ref = req.headers.get("referer");
  const back = ref && /^https?:\/\//.test(ref) ? ref : null;
  if (!b || !b.published_at) return page("Form not found", "This form isn't accepting messages.", back, 404);
  const fd = await req.formData().catch(() => null);
  if (!fd) return page("Something went wrong", "Please try again.", back, 400);
  if (String(fd.get("_hp") ?? "")) return page("Thanks!", "Your message has been sent.", back); // bots fill the hidden field
  const v = (k: string, n: number) => String(fd.get(k) ?? "").trim().slice(0, n);
  const data = { name: v("name", 120), email: v("email", 200), message: v("message", 5000), page: v("_page", 40) };
  if (!data.name || !data.message || !/^\S+@\S+\.\S+$/.test(data.email)) return page("Missing details", "Please go back and fill in your name, email and message.", back, 400);
  if (q.recentSubmissionCount(id) >= 50) return page("Please try later", "This site has received a lot of messages. Try again in an hour.", back, 429);
  q.addSubmission(id, JSON.stringify(data));
  const owner = q.userById(b.user_id);
  if (owner)
    await sendEmail({
      to: owner.email, subject: `New message from ${data.name} via ${b.name}`, heading: `New message on ${b.name}`,
      lines: [`From: ${data.name} <${data.email}>`, data.message], button: { label: "See all messages", href: link("/dashboard/websites") },
    });
  return page("Thanks!", "Your message has been sent. We'll be in touch soon.", back);
}
