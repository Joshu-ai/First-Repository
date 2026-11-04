import Link from "next/link";
import { lessons } from "@/lib/course";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";
import { BuyButton } from "@/components/BuyButton";
import { testCheckout } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const metadata = { title: "Course" };

export default async function Learn({ searchParams }: { searchParams: Promise<{ purchased?: string }> }) {
  const course = q.products("course")[0];
  const user = await currentUser();
  const owned = user ? q.hasPaidKind(user.id, "course") : false;
  const done = user ? q.completedLessons(user.id) : new Set<string>();
  const pct = Math.round((lessons.filter((l) => done.has(l.slug)).length / lessons.length) * 100);
  const { purchased } = await searchParams;
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <p className="text-sm text-muted">Course</p>
      <h1 className="mt-1 text-4xl font-bold tracking-tight">{course?.name ?? "Course"}</h1>
      <p className="mt-3 text-lg text-muted">{course?.tagline}</p>
      {purchased && <p role="status" className="mt-6 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">You&apos;re in! Every lesson is now unlocked.</p>}
      {owned ? (
        <div className="mt-8">
          <div className="flex justify-between text-sm"><span>Your progress</span><span>{pct}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-soft ring-1 ring-line"><div className="h-full bg-fg" style={{ width: `${pct}%` }} /></div>
        </div>
      ) : course ? (
        <div className="mt-8 flex flex-wrap items-center gap-6 rounded-xl border border-line p-6">
          <div className="flex-1"><p className="text-3xl font-bold">{money(course.price_cents)}</p><p className="text-sm text-muted">One-time · lifetime access · first lesson free</p></div>
          <div className="w-full sm:w-56"><BuyButton slug={course.slug} label={user ? "Get the course" : "Log in to buy"} /></div>
          {testCheckout && <p className="w-full text-xs text-amber-600 dark:text-amber-400">Test mode: checkout completes instantly without payment.</p>}
        </div>
      ) : null}
      <ol className="mt-10 space-y-3">
        {lessons.map((l, i) => {
          const open = owned || l.free;
          return (
            <li key={l.slug}>
              <Link href={`/learn/${l.slug}`} className="flex items-center gap-4 rounded-lg border border-line p-4 hover:bg-bg-soft">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm ${done.has(l.slug) ? "border-fg bg-fg text-bg" : "border-line"}`}>{done.has(l.slug) ? "✓" : i + 1}</span>
                <span className="min-w-0 flex-1"><span className="block font-medium">{l.title}</span><span className="block truncate text-sm text-muted">{l.summary}</span></span>
                <span className="shrink-0 text-xs text-muted">{l.free && !owned ? "Free · " : ""}{l.minutes} min {open ? "" : "🔒"}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
