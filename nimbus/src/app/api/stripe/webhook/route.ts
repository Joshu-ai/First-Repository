import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, fulfillSession, syncSubscription } from "@/lib/payments";
import { q } from "@/lib/db";

export async function POST(req: Request) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await fulfillSession((event.data.object as Stripe.Checkout.Session).id);
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    syncSubscription(event.data.object as Stripe.Subscription);
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (charge.payment_intent) {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: String(charge.payment_intent), limit: 1 });
      if (sessions.data[0]) q.markRefunded(sessions.data[0].id);
    }
  }
  return NextResponse.json({ received: true });
}
