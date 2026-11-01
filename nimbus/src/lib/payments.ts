import "server-only";
import crypto from "node:crypto";
import Stripe from "stripe";
import { q } from "./db";
import { money } from "./brand";
import { adminInbox, link, sendEmail } from "./email";

export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Without Stripe keys, purchases complete instantly so you can test locally.
// This is never allowed in production unless you explicitly opt in.
export const testCheckout = !stripe && (process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_CHECKOUT === "1");

export { siteUrl } from "./brand";

export function newLicenseKey() {
  const b = crypto.randomBytes(10).toString("hex").toUpperCase();
  return `LIC-${b.slice(0, 5)}-${b.slice(5, 10)}-${b.slice(10, 15)}-${b.slice(15, 20)}`;
}

/** When a customer switches hosting plans, stop billing them for the old one. */
async function retireOldPlans(userId: number) {
  for (const old of q.olderActiveSubs(userId)) {
    q.cancelSubRow(old.id);
    if (stripe && old.stripe_subscription_id) await stripe.subscriptions.cancel(old.stripe_subscription_id).catch(() => {});
  }
}

/** Marks an order paid and grants whatever the product unlocks. Idempotent. */
export async function fulfill(orderId: number, sub?: { id: string; status: string; periodEnd: number | null }) {
  const order = q.orderById(orderId);
  if (!order) return;
  const product = q.productById(order.product_id);
  if (!product) return;
  const firstTime = q.markPaid(orderId, newLicenseKey());
  if (product.kind === "service") q.createProject(orderId, order.user_id);
  if (product.kind === "hosting") {
    q.upsertSubscription({
      user_id: order.user_id, product_id: product.id,
      status: sub?.status ?? "active",
      stripe_subscription_id: sub?.id ?? null,
      current_period_end: sub?.periodEnd ? new Date(sub.periodEnd * 1000).toISOString() : null,
    });
    await retireOldPlans(order.user_id);
  }
  if (firstTime) await sendReceipts(orderId);
}

const nextStep: Record<string, { text: string; label: string; href: string }> = {
  download: { text: "Your download and license key are waiting in your dashboard.", label: "Download now", href: "/dashboard" },
  service: { text: "Next step: fill in your project brief so we can start designing.", label: "Fill in your brief", href: "/dashboard/projects" },
  course: { text: "Every lesson is now unlocked. Pick up wherever you like.", label: "Start the course", href: "/learn" },
  hosting: { text: "Your plan is active. Create a site and upload your build to go live.", label: "Set up hosting", href: "/dashboard/sites" },
};

async function sendReceipts(orderId: number) {
  const order = q.orderById(orderId);
  const product = order && q.productById(order.product_id);
  const user = order && q.userById(order.user_id);
  if (!order || !product || !user) return;
  const amount = `${money(order.amount_cents)}${product.interval ? " / month" : ""}`;
  const step = nextStep[product.kind];
  await sendEmail({
    to: user.email,
    subject: `Your receipt: ${product.name}`,
    heading: `Thanks for your order, ${user.name.split(" ")[0]}!`,
    lines: [
      `${product.name}: ${amount}`,
      `Order #${order.id}${order.license_key && product.kind === "download" ? ` · License ${order.license_key}` : ""}`,
      step.text,
    ],
    button: { label: step.label, href: link(step.href) },
  });
  await sendEmail({
    to: adminInbox(),
    subject: `New sale: ${product.name} (${amount})`,
    heading: "You made a sale 🎉",
    lines: [`${user.name} <${user.email}> bought ${product.name} for ${amount}.`, `Order #${order.id}`],
    button: { label: "Open admin", href: link(product.kind === "service" ? "/admin" : "/admin") },
  });
}

function periodEnd(s: Stripe.Subscription): number | null {
  // current_period_end moved onto subscription items in newer API versions.
  const item = s.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  return (s as unknown as { current_period_end?: number }).current_period_end ?? item?.current_period_end ?? null;
}

/** Confirms a Checkout Session with Stripe and fulfils its order. Safe to call more than once. */
export async function fulfillSession(sessionId: string) {
  if (!stripe) return;
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  const order = q.orderBySession(s.id);
  if (!order || s.payment_status !== "paid" || s.amount_total !== order.amount_cents) return;
  const sub = s.subscription && typeof s.subscription === "object" ? s.subscription : null;
  await fulfill(order.id, sub ? { id: sub.id, status: sub.status, periodEnd: periodEnd(sub) } : undefined);
}

/** Keeps hosting plans in sync when Stripe renews, fails or cancels a subscription. */
export function syncSubscription(sub: Stripe.Subscription) {
  const userId = Number(sub.metadata?.user_id);
  const productId = Number(sub.metadata?.product_id);
  if (!userId || !productId) return;
  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status === "past_due" ? "past_due" : "canceled";
  q.upsertSubscription({ user_id: userId, product_id: productId, status, stripe_subscription_id: sub.id, current_period_end: periodEnd(sub) ? new Date(periodEnd(sub)! * 1000).toISOString() : null });
}
