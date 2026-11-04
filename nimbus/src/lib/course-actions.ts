"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";
import { q } from "./db";
import { lessons } from "./course";

export async function toggleLesson(fd: FormData) {
  const slug = String(fd.get("slug"));
  const user = await requireUser(`/learn/${slug}`);
  const lesson = lessons.find((l) => l.slug === slug);
  if (!lesson || (!lesson.free && !q.hasPaidKind(user.id, "course"))) return;
  q.setLessonDone(user.id, slug, fd.get("done") === "1");
  revalidatePath("/learn");
  revalidatePath(`/learn/${slug}`);
}
