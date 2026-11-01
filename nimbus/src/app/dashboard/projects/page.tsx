import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";

export const metadata = { title: "Projects" };

export default async function Projects({ searchParams }: { searchParams: Promise<{ purchased?: string }> }) {
  const user = await requireUser("/dashboard/projects");
  const projects = q.projectsForUser(user.id);
  const { purchased } = await searchParams;
  return (
    <div>
      <h2 className="text-xl font-semibold">Website projects</h2>
      {purchased && <p role="status" className="mt-6 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">You&apos;re booked! Open your project below and fill in the brief so we can start.</p>}
      {projects.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-line p-10 text-center">
          <p className="text-muted">No projects yet.</p>
          <Link href="/services" className="mt-4 inline-block underline">See website packages</Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/dashboard/projects/${p.id}`} className="flex items-center justify-between rounded-lg border border-line p-5 hover:bg-bg-soft">
                <div><p className="font-medium">{p.product_name} website · #{p.id}</p><p className="mt-1 text-xs text-muted">Started {p.created_at.slice(0, 10)}</p></div>
                <span className="rounded-full border border-line px-3 py-1 text-xs capitalize">{p.brief ? p.status : "brief needed"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
