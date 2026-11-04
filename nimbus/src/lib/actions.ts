"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, q } from "./db";
import crypto from "node:crypto";
import { createSession, destroySession, isAdminEmail } from "./auth";
import { link, sendEmail } from "./email";

export type FormState = { error?: string } | undefined;

const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function signup(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password } = parsed.data;
  if (q.userByEmail(email)) return { error: "An account with that email already exists." };
  const hash = await bcrypt.hash(password, 12);
  // First account ever, or an email listed in ADMIN_EMAILS, becomes an admin.
  const first = (db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
  const id = q.createUser(email, name, hash, first || isAdminEmail(email));
  await createSession(id);
  redirect(safeNext(fd.get("next")));
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const u = q.userByEmail(email);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return { error: "Wrong email or password." };
  await createSession(u.id);
  redirect(safeNext(fd.get("next")));
}

export async function logout() {
  await destroySession();
  redirect("/");
}

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export async function requestReset(_: { sent?: boolean } | undefined, fd: FormData): Promise<{ sent?: boolean }> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const u = q.userByEmail(email);
  if (u) {
    const token = crypto.randomBytes(32).toString("base64url");
    q.createReset(sha(token), u.id);
    await sendEmail({
      to: u.email, subject: "Reset your password", heading: "Reset your password",
      lines: ["Someone (hopefully you) asked to reset your password. This link works once and expires in 1 hour.", "If you didn't ask for this, you can ignore this email."],
      button: { label: "Choose a new password", href: link(`/reset-password?token=${token}`) },
    });
  }
  // Same answer either way, so this form can't be used to find out who has an account.
  return { sent: true };
}

export async function resetPassword(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password.length < 8 || password.length > 200) return { error: "Password must be at least 8 characters." };
  const r = q.validReset(sha(token));
  if (!r) return { error: "This reset link is invalid or has expired. Request a new one." };
  q.useReset(sha(token), r.user_id, await bcrypt.hash(password, 12));
  await createSession(r.user_id);
  redirect("/dashboard?reset=1");
}
