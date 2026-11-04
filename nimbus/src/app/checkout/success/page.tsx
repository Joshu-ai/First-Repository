import { redirect } from "next/navigation";
import { fulfillSession } from "@/lib/payments";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  await requireUser();
  const { session_id } = await searchParams;
  // The webhook is the source of truth; this just avoids a wait if the redirect beats it.
  if (session_id) await fulfillSession(session_id).catch(() => {});
  const order = session_id ? q.orderBySession(session_id) : undefined;
  const kind = order ? q.productById(order.product_id)?.kind : undefined;
  const dest = ({ service: "/dashboard/projects", course: "/learn", hosting: "/dashboard/sites" } as Record<string, string>)[kind ?? ""] ?? "/dashboard";
  redirect(`${dest}?purchased=1`);
}
