"use server";
import { redirect } from "next/navigation";
import { requireUser } from "./auth";
import { q } from "./db";
import { fulfill, siteUrl, stripe, testCheckout } from "./payments";
import { brand } from "./brand";

const landing: Record<string, (slug: string) => string> = {
  download: (s) => `/store/${s}`,
  service: () => `/services`,
  course: () => `/learn`,
  hosting: () => `/hosting`,
};
const afterPurchase: Record<string, string> = {
  download: "/dashboard?purchased=1",
  service: "/dashboard/projects?purchased=1",
  course: "/learn?purchased=1",
  hosting: "/dashboard/sites?purchased=1",
};

export async function buy(fd: FormData) {
  const slug = String(fd.get("slug") ?? "");
  const product = q.productBySlug(slug);
  if (!product || !product.active) redirect("/");
  const back = landing[product.kind](product.slug);
  const user = await requireUser(back);

  // One-time digital products and the course can only be bought once.
  if ((product.kind === "download" && q.paidOrderFor(user.id, product.id)) || (product.kind === "course" && q.hasPaidKind(user.id, "course"))) {
    redirect(afterPurchase[product.kind]);
  }
  if (product.kind === "hosting" && q.activePlan(user.id)?.id === product.id) redirect("/dashboard/sites");

  const orderId = q.createOrder(user.id, product.id, product.price_cents);

  if (stripe) {
    const recurring = product.interval === "month";
    const session = await stripe.checkout.sessions.create({
      mode: recurring ? "subscription" : "payment",
      customer_email: user.email,
      client_reference_id: String(orderId),
      metadata: { order_id: String(orderId) },
      ...(recurring ? { subscription_data: { metadata: { user_id: String(user.id), product_id: String(product.id) } } } : {}),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: brand.currency,
          unit_amount: product.price_cents,
          product_data: { name: product.name, description: product.tagline || undefined },
          ...(recurring ? { recurring: { interval: "month" as const } } : {}),
        },
      }],
      success_url: `${siteUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}${back}?canceled=1`,
    });
    q.setOrderSession(orderId, session.id);
    redirect(session.url!);
  }

  if (testCheckout) {
    await fulfill(orderId);
    redirect(afterPurchase[product.kind]);
  }
  throw new Error("Payments are not configured. Set STRIPE_SECRET_KEY.");
}

export async function openBillingPortal() {
  const user = await requireUser("/dashboard");
  if (!stripe) redirect("/dashboard");
  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  if (!customers.data[0]) redirect("/dashboard");
  const portal = await stripe.billingPortal.sessions.create({ customer: customers.data[0].id, return_url: `${siteUrl()}/dashboard` });
  redirect(portal.url);
}
