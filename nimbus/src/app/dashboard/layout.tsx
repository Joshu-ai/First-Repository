import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { stripe } from "@/lib/payments";
import { openBillingPortal } from "@/lib/store-actions";

const tabs = [["/dashboard/websites", "Websites"], ["/dashboard", "Purchases"], ["/dashboard/projects", "Projects"], ["/learn", "Course"], ["/dashboard/sites", "Hosting"]];

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Hi, {user.name.split(" ")[0]}</h1><p className="text-sm text-muted">{user.email}</p></div>
        <div className="flex gap-2">
          {user.is_admin ? <Link href="/admin" className="h-9 rounded-md border border-line px-3 text-sm leading-9">Admin</Link> : null}
          {stripe && <form action={openBillingPortal}><button className="h-9 rounded-md border border-line px-3 text-sm">Billing</button></form>}
          <form action={logout}><button className="h-9 rounded-md border border-line px-3 text-sm">Log out</button></form>
        </div>
      </div>
      <nav className="mt-8 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([h, l]) => <Link key={h} href={h} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-fg">{l}</Link>)}
      </nav>
      <div className="pt-8">{children}</div>
    </div>
  );
}
