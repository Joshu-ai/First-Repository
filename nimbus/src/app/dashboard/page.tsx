import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ purchased?: string; reset?: string }> }) {
  const user = await requireUser();
  const orders = q.ordersForUser(user.id).filter((o) => o.kind === "download");
  const { purchased, reset } = await searchParams;
  return (
    <div>
      <h2 className="text-xl font-semibold">Templates & kits</h2>
      {reset && <p role="status" className="mt-6 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">Your password has been changed.</p>}
      {purchased && <p role="status" className="mt-6 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">Thanks for your purchase! Your download is below. If it isn&apos;t showing yet, refresh in a few seconds.</p>}
      {orders.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line p-10 text-center">
          <p className="text-muted">You haven&apos;t bought anything yet.</p>
          <Link href="/store" className="mt-4 inline-block underline">Browse templates</Link>
        </div>
      ) : (
        <ul className="mt-10 space-y-4">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-5">
              <div className="min-w-0 flex-1">
                <Link href={`/store/${o.product_slug}`} className="font-medium hover:underline">{o.product_name}</Link>
                <p className="mt-1 text-xs text-muted">Order #{o.id} · {money(o.amount_cents)} · {o.paid_at?.slice(0, 10)}</p>
                <p className="mt-2 font-mono text-xs">License: <span className="select-all">{o.license_key}</span></p>
              </div>
              {o.file_name
                ? <a href={`/api/download/${o.id}`} className="h-9 rounded-md bg-fg px-4 text-sm font-medium leading-9 text-bg">Download</a>
                : <span className="text-xs text-muted">File coming soon. We&apos;ll email you.</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
