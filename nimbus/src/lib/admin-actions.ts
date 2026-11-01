"use server";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { FILES_DIR, q } from "./db";

const schema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, "Slug: lowercase letters, numbers and dashes"),
  name: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).default(""),
  description: z.string().trim().max(5000).default(""),
  price: z.coerce.number().min(0.5, "Price must be at least 0.50").max(100000),
  category: z.string().trim().min(1).max(40),
  features: z.string().default(""),
  active: z.string().optional(),
  kind: z.enum(["download", "service", "course", "hosting"]).default("download"),
  plan_sites: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function saveProduct(_: { error?: string; ok?: string } | undefined, fd: FormData) {
  await requireAdmin();
  const parsed = schema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  let file_name: string | null = null;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    const safe = `${d.slug}-${Date.now()}${path.extname(file.name).replace(/[^.a-z0-9]/gi, "") || ".zip"}`;
    fs.mkdirSync(FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FILES_DIR, safe), Buffer.from(await file.arrayBuffer()));
    file_name = safe;
  }
  q.upsertProduct({
    slug: d.slug, name: d.name, tagline: d.tagline, description: d.description,
    price_cents: Math.round(d.price * 100), category: d.category,
    features: JSON.stringify(d.features.split("\n").map((s) => s.trim()).filter(Boolean)),
    file_name, active: d.active ? 1 : 0,
    kind: d.kind, interval: d.kind === "hosting" ? "month" : null, plan_sites: d.plan_sites,
  });
  revalidatePath("/admin");
  revalidatePath("/store");
  return { ok: `Saved “${d.name}”.` };
}
