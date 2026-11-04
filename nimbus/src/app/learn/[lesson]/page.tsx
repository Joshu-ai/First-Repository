import Link from "next/link";
import { notFound } from "next/navigation";
import { lessons } from "@/lib/course";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { CodeBlock } from "@/components/CodeBlock";
import { BuyButton } from "@/components/BuyButton";
import { toggleLesson } from "@/lib/course-actions";

export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ lesson: string }> }) {
  const slug = (await params).lesson;
  const i = lessons.findIndex((l) => l.slug === slug);
  if (i < 0) notFound();
  const l = lessons[i];
  const user = await currentUser();
  const owned = user ? q.hasPaidKind(user.id, "course") : false;
  const course = q.products("course")[0];
  const unlocked = owned || l.free;
  const done = user ? q.completedLessons(user.id).has(l.slug) : false;
  const prev = lessons[i - 1];
  const next = lessons[i + 1];
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <Link href="/learn" className="text-sm text-muted hover:text-fg">← All lessons</Link>
      <p className="mt-6 text-sm text-muted">Lesson {i + 1} of {lessons.length} · {l.minutes} min</p>
      <h1 className="mt-1 text-4xl font-bold tracking-tight">{l.title}</h1>
      <p className="mt-3 text-lg text-muted">{l.summary}</p>
      {unlocked ? (
        <>
          <div className="prose-doc mt-8">{l.body.map((b, k) => <p key={k}>{b}</p>)}</div>
          {l.code && <CodeBlock {...l.code} />}
          {user && (
            <form action={toggleLesson} className="mt-10">
              <input type="hidden" name="slug" value={l.slug} /><input type="hidden" name="done" value={done ? "0" : "1"} />
              <button className={`h-10 rounded-md px-5 text-sm font-medium ${done ? "border border-line" : "bg-fg text-bg"}`}>{done ? "✓ Completed · undo" : "Mark as complete"}</button>
            </form>
          )}
        </>
      ) : (
        <div className="mt-10 rounded-xl border border-line p-8 text-center">
          <p className="text-2xl">🔒</p>
          <p className="mt-2 font-medium">This lesson is part of the full course.</p>
          {course && <div className="mx-auto mt-6 max-w-xs"><BuyButton slug={course.slug} label={user ? "Unlock all lessons" : "Log in to buy"} /></div>}
        </div>
      )}
      <nav className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
        {prev ? <Link href={`/learn/${prev.slug}`} className="rounded-lg border border-line p-4 hover:bg-bg-soft"><span className="text-xs text-muted">Previous</span><div className="font-medium">{prev.title}</div></Link> : <span />}
        {next && <Link href={`/learn/${next.slug}`} className="rounded-lg border border-line p-4 text-right hover:bg-bg-soft"><span className="text-xs text-muted">Next</span><div className="font-medium">{next.title}</div></Link>}
      </nav>
    </article>
  );
}
