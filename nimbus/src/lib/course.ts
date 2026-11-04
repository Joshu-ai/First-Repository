// Course content. Edit freely, or move to MDX files later.
export type Lesson = { slug: string; title: string; minutes: number; free?: boolean; summary: string; body: string[]; code?: { file: string; lang: string; source: string } };

export const lessons: Lesson[] = [
  {
    slug: "plan-your-product", title: "Plan a product people will pay for", minutes: 12, free: true,
    summary: "Pick a narrow problem, a clear buyer and a price before you write code.",
    body: [
      "Most side projects fail because they solve a vague problem for everyone. Start by writing one sentence: who is the buyer, what painful task do they do today, and what will they pay to make it go away.",
      "Pick a price before you build. A price forces you to think about value: a $9/month tool needs many customers, a $500 one-time service needs a few. Write down how many customers you need to hit your first goal.",
      "Finally, list the smallest set of features that delivers the promise. Everything else goes on a 'later' list. You'll build exactly that list in the next lessons.",
    ],
  },
  {
    slug: "set-up-the-project", title: "Set up the project", minutes: 15,
    summary: "Create the app, understand the folder layout, and run it locally.",
    body: [
      "Create a new app with the official starter, choosing TypeScript, the App Router and Tailwind. Run the dev server and open the home page.",
      "Every folder inside app/ becomes a URL. A page.tsx file renders that URL, and a layout.tsx file wraps every page below it. Keep shared UI like the header and footer in the root layout.",
    ],
    code: { file: "Terminal", lang: "bash", source: "npx create-next-app@latest my-product --ts --app --tailwind\ncd my-product\nnpm run dev" },
  },
  {
    slug: "pages-and-layouts", title: "Pages, layouts and navigation", minutes: 18,
    summary: "Build the landing page, pricing page and a shared navigation bar.",
    body: [
      "Your landing page has one job: explain the promise from lesson 1 and send people to pricing. Use a headline, a sentence of detail, a primary button and three short benefit blocks.",
      "Use the Link component for navigation so page changes are instant. Highlight the active link by reading the current path in a small client component.",
    ],
    code: { file: "app/layout.tsx", lang: "tsx", source: "export default function RootLayout({ children }) {\n  return (\n    <html lang=\"en\">\n      <body>\n        <Header />\n        {children}\n      </body>\n    </html>\n  )\n}" },
  },
  {
    slug: "data-and-database", title: "Store data in a database", minutes: 20,
    summary: "Design tables for users, products and orders, and query them from server components.",
    body: [
      "Start with three tables: users, products and orders. An order links a user to a product with an amount and a status. Keep money in whole cents to avoid rounding bugs.",
      "Server components can query the database directly, with no API in between. Keep queries in one module so you can swap SQLite for Postgres later without touching pages.",
    ],
    code: { file: "lib/db.ts", lang: "ts", source: "export const getProducts = () =>\n  db.prepare('SELECT * FROM products WHERE active = 1').all()" },
  },
  {
    slug: "accounts-and-sessions", title: "Accounts and sessions", minutes: 22,
    summary: "Sign up, log in, hash passwords and keep users signed in safely.",
    body: [
      "Never store raw passwords. Hash them with bcrypt and compare hashes on login. Store the session in an httpOnly, secure cookie so page scripts can't read it.",
      "Protect pages on the server: read the session at the top of the page and redirect to the login page if it's missing. Pass a 'next' parameter so users land back where they started.",
    ],
  },
  {
    slug: "take-payments", title: "Take payments with Stripe", minutes: 25,
    summary: "Create Checkout sessions, handle webhooks, and grant access only after payment.",
    body: [
      "Create a pending order, then a Stripe Checkout session with the order id in its metadata, and redirect the customer to Stripe's hosted page.",
      "Grant access in the webhook, not on the success page. The webhook is signed by Stripe, so you know the payment is real. Make fulfilment idempotent: running it twice should change nothing.",
    ],
    code: { file: "app/api/stripe/webhook/route.ts", lang: "ts", source: "const event = stripe.webhooks.constructEvent(body, sig, secret)\nif (event.type === 'checkout.session.completed') {\n  await fulfill(event.data.object.id)\n}" },
  },
  {
    slug: "deliver-the-product", title: "Deliver what you sold", minutes: 15,
    summary: "Secure downloads, license keys and a customer dashboard.",
    body: [
      "Serve paid files from a route handler that checks the logged-in user owns a paid order before streaming the file. Never put paid files in the public folder.",
      "Give each order a license key and show it on the dashboard with the download button. This also gives customers something to quote when they ask for support.",
    ],
  },
  {
    slug: "launch", title: "Launch and get your first customers", minutes: 18,
    summary: "Deploy, set environment variables, switch Stripe to live mode, and tell people.",
    body: [
      "Deploy to a host with a persistent disk (or move to Postgres), set your secrets as environment variables, and register the live webhook endpoint in Stripe.",
      "Make a test purchase with a real card and refund it. Then post where your buyers already hang out, and talk to every early customer. Their questions are your next features.",
    ],
  },
];
