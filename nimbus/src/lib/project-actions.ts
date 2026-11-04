"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "./auth";
import { PROJECT_STAGES, q } from "./db";
import { adminInbox, link, sendEmail } from "./email";

async function access(projectId: number) {
  const user = await requireUser(`/dashboard/projects/${projectId}`);
  const p = q.projectById(projectId);
  if (!p || (p.user_id !== user.id && !user.is_admin)) throw new Error("Not found");
  return { user, p };
}

const briefSchema = z.object({
  business: z.string().trim().min(1, "Tell us your business name").max(200),
  about: z.string().trim().min(10, "Tell us a bit more about what you do").max(4000),
  audience: z.string().trim().max(2000).default(""),
  pages: z.string().trim().max(2000).default(""),
  style: z.string().trim().max(2000).default(""),
  examples: z.string().trim().max(2000).default(""),
  domain: z.string().trim().max(200).default(""),
  deadline: z.string().trim().max(100).default(""),
});

export async function submitBrief(_: { error?: string } | undefined, fd: FormData) {
  const id = Number(fd.get("projectId"));
  const { p } = await access(id);
  const parsed = briefSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const isNew = !p.brief;
  q.setBrief(p.id, JSON.stringify(parsed.data));
  if (isNew) await sendEmail({
    to: adminInbox(), subject: `Brief submitted: ${parsed.data.business} (project #${p.id})`,
    heading: "A new brief is in", lines: [`${p.customer_name} submitted the brief for ${parsed.data.business}.`, parsed.data.about],
    button: { label: "Open project", href: link(`/dashboard/projects/${p.id}`) },
  });
  revalidatePath(`/dashboard/projects/${id}`);
  return {};
}

export async function sendMessage(fd: FormData) {
  const id = Number(fd.get("projectId"));
  const { user } = await access(id);
  const body = String(fd.get("body") ?? "").trim().slice(0, 5000);
  if (!body) return;
  const p = q.projectById(id)!;
  q.addProjectMessage(id, user.id, body);
  const fromTeam = !!user.is_admin && p.user_id !== user.id;
  await sendEmail({
    to: fromTeam ? p.email : adminInbox(),
    subject: fromTeam ? `New message about your ${p.product_name} website` : `Message from ${p.customer_name} (project #${p.id})`,
    heading: fromTeam ? "You have a new message" : `${p.customer_name} wrote:`,
    lines: [body],
    button: { label: "Reply", href: link(`/dashboard/projects/${id}`) },
  });
  revalidatePath(`/dashboard/projects/${id}`);
}

export async function updateProject(fd: FormData) {
  const id = Number(fd.get("projectId"));
  const { user, p } = await access(id);
  if (!user.is_admin) throw new Error("Admins only");
  const status = String(fd.get("status"));
  if (!(PROJECT_STAGES as readonly string[]).includes(status)) throw new Error("Bad status");
  const url = String(fd.get("live_url") ?? "").trim();
  q.setProjectStatus(id, status, /^https?:\/\//.test(url) ? url : null);
  if (status !== p.status) {
    const msg: Record<string, string> = {
      design: "We've started designing your site.",
      build: "Your design is done and we're building the site now.",
      review: "Your site is ready for you to review. Take a look and send us any changes.",
      launched: "Your website is live! 🎉",
    };
    await sendEmail({
      to: p.email, subject: `Your ${p.product_name} website: ${status}`, heading: `Update: ${status}`,
      lines: [msg[status] ?? `Your project moved to "${status}".`, ...(status === "launched" && url ? [url] : [])],
      button: { label: "View project", href: link(`/dashboard/projects/${id}`) },
    });
  }
  revalidatePath(`/dashboard/projects/${id}`);
}
