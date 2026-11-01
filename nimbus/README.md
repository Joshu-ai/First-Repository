# Nimbus: templates, website services, a course and hosting, in one Next.js app

One account system and one Stripe checkout power four ways to make money:

| Business | Customer pages | What they get after paying |
|---|---|---|
| **Template store** | `/store`, `/store/[slug]` | License key + secure download in `/dashboard` |
| **Website-building service** | `/services` | A project in `/dashboard/projects`: intake brief, 5-stage progress tracker, messages with you |
| **Paid course** | `/learn`, `/learn/[lesson]` | All 8 lessons unlocked (lesson 1 is a free preview), progress tracking |
| **Static hosting** (monthly) | `/hosting` | `/dashboard/sites`: create sites up to the plan limit, upload a .zip/.tar.gz build, live URL |

You run it all from **`/admin`**: revenue, monthly recurring revenue, orders, projects (move stages, set live URL, reply),
subscriptions, and products (add or edit any product, set prices, upload template files).

**Emails** (via Resend): a receipt for every purchase with the next step, a new-sale alert to you, a "brief submitted" alert,
project messages in both directions, project stage updates to the customer, and password reset (one-time link, expires in
1 hour, signs the user out of other devices).

The original marketing pages (docs, blog, showcase, Cmd+K search, newsletter, light/dark theme) are still there.

## Run locally

```bash
npm install
cp .env.example .env.local    # optional for local testing
npm run dev                   # http://localhost:3000
```

- The **first account you sign up with becomes the admin.** Add more admins with `ADMIN_EMAILS`.
- With no Stripe keys, checkout is in **test mode**: purchases complete instantly and for free so you can click through
  everything. Test mode is switched off in production unless you set `ALLOW_TEST_CHECKOUT=1`.
- Needs **Node 22.5+** (uses the built-in `node:sqlite`, so there are no native database packages to install).

## Before you sell: checklist

1. **Brand.** Set `NEXT_PUBLIC_BRAND_NAME` and `NEXT_PUBLIC_SUPPORT_EMAIL`, replace the logo in `src/components/Logo.tsx`,
   and the license key prefix in `src/lib/payments.ts`.
2. **Products and prices.** Edit them in `/admin`. For each template, upload the real .zip. (Launch Docs Kit ships with a
   working file; the other three seeded templates need your files before you list them.)
3. **Course content.** Lessons live in `src/lib/course.ts`. Expand them, add videos, etc.
4. **Stripe.**
   - Set `STRIPE_SECRET_KEY`.
   - In the Stripe dashboard, add a webhook endpoint `https://YOUR_DOMAIN/api/stripe/webhook` with events
     `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `charge.refunded`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   - Turn on the Customer Portal (Settings → Billing → Customer portal) so the dashboard's **Billing** button lets
     hosting customers update cards and cancel.
   - Do one real purchase of each type in live mode and refund it.
5. **Secrets.** `AUTH_SECRET` = 32+ random characters (`openssl rand -base64 48`). The app refuses to start in production without it.
6. **Hosting domain.** Buy a separate domain for customer sites (e.g. `yourbrandsites.com`), add a wildcard DNS record
   `*.yourbrandsites.com` pointing at this app, and set `HOSTING_DOMAIN=yourbrandsites.com`. Customer sites are then served at
   `https://<site>.yourbrandsites.com`. Use a separate domain so customer code can never touch your store's cookies.
   (Sites are also served with a sandbox Content-Security-Policy as a second layer of protection.)
7. **Email.** Sign up at resend.com, verify your sending domain, then set `RESEND_API_KEY` and `EMAIL_FROM`.
   Until then, every email is saved to `DATA_DIR/outbox/` instead of sent (handy for testing).
   Alerts go to `ADMIN_NOTIFY_EMAIL` (set to joshualef@duck.com in `.env.example`).
8. **Legal pages.** Write real Terms, Privacy and Refund policies and link them in `src/components/Footer.tsx`.

## Deploy

This app keeps its database and uploaded files on disk (`DATA_DIR`), so it needs a host with a **persistent disk**:
Render (web service + disk), Railway (volume), Fly.io (volume), or any VPS. Serverless hosts like Vercel or Netlify
**won't keep the data**. To use one of those, move `src/lib/db.ts` to Postgres and files to S3/R2 first.

A `Dockerfile` is included:

```bash
docker build -t nimbus .
docker run -p 3000:3000 -v nimbus-data:/data --env-file .env.production nimbus
```

Back up `DATA_DIR` (it holds `store.db` and all uploaded files).

## Not built yet (good next steps)

- **Hosting from GitHub**: hosting currently takes uploaded static builds. Building customer repos automatically
  (and server-side apps) needs build workers and is a bigger project.
- Custom domains per hosted site, usage analytics, coupons/discount codes, team accounts.

## Where things live

```
src/lib/db.ts            schema, seed products, all queries (SQLite)
src/lib/auth.ts          sessions (signed httpOnly cookie), requireUser/requireAdmin
src/lib/payments.ts      Stripe, test checkout, fulfilment for each product type
src/lib/store-actions.ts buy (one-time or subscription), billing portal
src/lib/email.ts         email templates + Resend sender (dev: writes to data/outbox)
src/lib/hosting.ts       safe archive extraction, atomic deploys, static file serving
src/middleware.ts        routes <site>.HOSTING_DOMAIN to customer sites
src/app/api/stripe/webhook  payment + subscription events
src/app/admin            admin dashboard
```
