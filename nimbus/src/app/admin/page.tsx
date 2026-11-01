import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import { money } from "@/lib/brand";
import { stripe, testCheckout } from "@/lib/payments";
import Link from "next/link";
import { ProductForm } from "./product-form";

export const metadata = { title: "Admin" };

export default async function Admin() {
  await requireAdmin();
  const s = q.stats();
  const products = q.products(undefined, true);
  const orders = q.allOrders();
  const projects = q.allProjects();
  const subs = q.allSubscriptions();
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <p className="mt-1 text-sm text-muted">Payments: {stripe ? "Stripe connected" : testCheckout ? "TEST MODE (no Stripe keys, purchases are free)" : "not configured"}</p>
      <dl className="mt-8 grid grid-cols-2 gap-px md:grid-cols-4 overflow-hidden rounded-xl border border-line bg-line">
        {[["Revenue", money(s.revenue)], ["Monthly recurring", money(s.mrr)], ["Sales", String(s.sales)], ["Accounts", String(s.customers)]].map(([l, v]) => (
          <div key={l} className="bg-bg p-5"><dt className="text-sm text-muted">{l}</dt><dd className="mt-1 text-2xl font-semibold">{v}</dd></div>
        ))}
      </dl>

      <h2 className="mt-14 text-xl font-semibold">Website projects</h2>
      <ul className="mt-4 space-y-2">
        {projects.length === 0 && <li className="text-sm text-muted">No projects yet.</li>}
        {projects.map((p) => (
          <li key={p.id}><Link href={`/dashboard/projects/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-4 py-3 text-sm hover:bg-bg-soft">
            <span>#{p.id} · {p.product_name} · {p.email}</span><span className="rounded-full border border-line px-2 py-0.5 text-xs capitalize">{p.brief ? p.status : "awaiting brief"}</span>
          </Link></li>
        ))}
      </ul>

      <h2 className="mt-14 text-xl font-semibold">Hosting subscriptions</h2>
      <ul className="mt-4 space-y-2 text-sm">
        {subs.length === 0 && <li className="text-muted">No subscriptions yet.</li>}
        {subs.map((x) => <li key={x.id} className="rounded-lg border border-line px-4 py-3">{x.email} · {x.plan} · {money(x.price_cents)}/mo · <span className="capitalize">{x.status}</span>{x.current_period_end ? ` · renews ${x.current_period_end.slice(0, 10)}` : ""}</li>)}
      </ul>

      <h2 className="mt-14 text-xl font-semibold">Recent orders</h2>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-muted"><tr>{["#", "Customer", "Product", "Amount", "Status", "Date"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No orders yet.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-line">
                <td className="px-4 py-2">{o.id}</td><td className="px-4 py-2">{o.email}</td><td className="px-4 py-2">{o.product_name}</td>
                <td className="px-4 py-2">{money(o.amount_cents)}</td><td className="px-4 py-2">{o.status}</td><td className="px-4 py-2">{o.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-14 text-xl font-semibold">Add a product</h2>
      <div className="mt-4 rounded-lg border border-line p-6"><ProductForm /></div>

      <h2 className="mt-14 text-xl font-semibold">Products</h2>
      <div className="mt-4 space-y-4">
        {products.map((p) => (
          <details key={p.id} className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm"><span className="font-medium">{p.name}</span> · <span className="capitalize">{p.kind}</span> · {money(p.price_cents)}{p.interval ? "/mo" : ""} · {p.active ? "listed" : "hidden"} · {p.kind !== "download" ? null : p.file_name ? "file uploaded" : <span className="text-amber-600 dark:text-amber-400">no file yet</span>}</summary>
            <div className="mt-4"><ProductForm p={p} /></div>
          </details>
        ))}
      </div>
    </div>
  );
}
