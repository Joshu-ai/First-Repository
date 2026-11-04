import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
export const FILES_DIR = path.join(DATA_DIR, "files");

export type User = { id: number; email: string; name: string; password_hash: string; is_admin: number; session_version: number; created_at: string };
export type Product = {
  id: number; slug: string; name: string; tagline: string; description: string; price_cents: number;
  category: string; features: string; file_name: string | null; active: number; created_at: string;
  kind: "download" | "service" | "course" | "hosting"; interval: string | null; plan_sites: number;
};
export type Project = { id: number; order_id: number; user_id: number; status: string; brief: string | null; live_url: string | null; created_at: string; updated_at: string };
export type Site = { id: number; user_id: number; slug: string; name: string; deployed_at: string | null; file_count: number; bytes: number; created_at: string };
export const PROJECT_STAGES = ["intake", "design", "build", "review", "launched"] as const;
export type Order = {
  id: number; user_id: number; product_id: number; amount_cents: number; status: "pending" | "paid" | "refunded";
  stripe_session_id: string | null; license_key: string | null; created_at: string; paid_at: string | null;
};

const g = globalThis as unknown as { __db?: DatabaseSync };

function open() {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "store.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'Starter',
      features TEXT NOT NULL DEFAULT '[]',
      file_name TEXT,
      kind TEXT NOT NULL DEFAULT 'download', -- download | service | course | hosting
      interval TEXT,                          -- NULL for one-time, 'month' for subscriptions
      plan_sites INTEGER NOT NULL DEFAULT 0,  -- hosting: how many sites the plan allows
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_session_id TEXT UNIQUE,
      license_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'intake', -- intake | design | build | review | launched
      brief TEXT,                            -- JSON from the intake form
      live_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS project_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id INTEGER NOT NULL REFERENCES users(id),
      lesson_slug TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, lesson_slug)
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      status TEXT NOT NULL,               -- active | past_due | canceled
      stripe_subscription_id TEXT UNIQUE,
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      deployed_at TEXT,
      file_count INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  seed(db);
  return db;
}

function seed(db: DatabaseSync) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM products").get() as { n: number };
  if (n.n > 0) return;
  const ins = db.prepare(
    `INSERT INTO products (slug, name, tagline, description, price_cents, category, features, file_name, kind, interval, plan_sites)
     VALUES (@slug, @name, @tagline, @description, @price_cents, @category, @features, @file_name, @kind, @interval, @plan_sites)`,
  );
  type Seed = { slug: string; name: string; tagline: string; description: string; price: number; category: string; features: string[]; file?: string; kind?: string; interval?: string; sites?: number };
  const items: Seed[] = [
    // 1. Template store
    { slug: "launch-docs-kit", name: "Launch Docs Kit", category: "Marketing", price: 49, file: "launch-docs-kit.tar.gz",
      tagline: "A framework-style marketing site with full docs, blog and showcase.",
      description: "Everything you need to launch a developer product: a landing page, a searchable docs section with sidebar and table of contents, a blog, a showcase with filters, and a light/dark theme. Built with Next.js App Router, TypeScript and Tailwind.",
      features: ["Next.js 15 App Router + TypeScript", "Docs with sidebar, TOC and Cmd+K search", "Blog, showcase and templates pages", "Light / dark / system theme", "Lifetime updates"] },
    { slug: "saas-starter", name: "SaaS Starter", category: "SaaS", price: 99,
      tagline: "Accounts, payments and a dashboard, ready to customize.",
      description: "A production-ready starting point for products that charge money: email/password auth, Stripe checkout and webhooks, a customer dashboard and an admin panel. Upload your build of this kit from the admin page.",
      features: ["Auth with secure sessions", "Stripe checkout + webhooks", "Customer dashboard", "Admin panel with sales"] },
    { slug: "commerce-storefront", name: "Commerce Storefront", category: "Commerce", price: 79,
      tagline: "A fast storefront with product pages and cart.",
      description: "A clean storefront template with category pages, product detail pages, a cart drawer and checkout hand-off. Upload your build of this kit from the admin page.",
      features: ["Product + category pages", "Cart drawer", "SEO metadata and sitemap", "Image optimization"] },
    { slug: "ai-chat-kit", name: "AI Chat Kit", category: "AI", price: 69,
      tagline: "A streaming chat UI with a pluggable model backend.",
      description: "Ship an AI assistant fast: streaming responses, chat history, markdown rendering and a provider-agnostic server route. Upload your build of this kit from the admin page.",
      features: ["Streaming responses", "Chat history", "Markdown + code rendering", "Provider-agnostic API route"] },
    // 2. Website-building service
    { slug: "site-launch", name: "Launch", kind: "service", category: "Service", price: 1500,
      tagline: "A polished one-page site, live in two weeks.",
      description: "We design and build a fast single-page website from your brief, connect your domain and hand over the code.",
      features: ["1 page, up to 6 sections", "Custom design from your brand", "Mobile-first, SEO basics", "Domain + hosting setup", "2 rounds of revisions"] },
    { slug: "site-business", name: "Business", kind: "service", category: "Service", price: 4500,
      tagline: "A multi-page site with a CMS your team can edit.",
      description: "Up to 8 pages, a blog or news section, contact forms and analytics. Ideal for growing businesses.",
      features: ["Up to 8 pages", "Blog / CMS", "Forms + analytics", "Performance + SEO tuning", "3 rounds of revisions", "30 days of support"] },
    { slug: "site-product", name: "Product", kind: "service", category: "Service", price: 12000,
      tagline: "A full web app: accounts, payments and a dashboard.",
      description: "For founders launching a product: user accounts, Stripe billing, a customer dashboard and an admin panel.",
      features: ["Accounts + roles", "Stripe payments", "Customer dashboard + admin", "Docs or help center", "60 days of support"] },
    // 3. Paid course
    { slug: "course-ship-it", name: "Ship It: Build and Sell a Web App", kind: "course", category: "Course", price: 129,
      tagline: "Go from empty folder to a paid product in 8 lessons.",
      description: "A hands-on course that walks through building, charging for, and launching a real web app with Next.js.",
      features: ["8 lessons, with code", "Lifetime access + updates", "First lesson free", "Progress tracking"] },
    // 4. Hosting
    { slug: "hosting-hobby", name: "Hosting Hobby", kind: "hosting", interval: "month", sites: 1, category: "Hosting", price: 9,
      tagline: "One static site with free SSL.", description: "Upload a static build and get a live URL in seconds.",
      features: ["1 site", "Unlimited deploys", "Free SSL", "Global caching"] },
    { slug: "hosting-pro", name: "Hosting Pro", kind: "hosting", interval: "month", sites: 10, category: "Hosting", price: 29,
      tagline: "Up to 10 sites for freelancers and small teams.", description: "Everything in Hobby, for up to ten sites.",
      features: ["10 sites", "Unlimited deploys", "Free SSL", "Priority support"] },
  ];
  for (const it of items)
    ins.run({
      slug: it.slug, name: it.name, tagline: it.tagline, description: it.description, price_cents: Math.round(it.price * 100),
      category: it.category, features: JSON.stringify(it.features), file_name: it.file ?? null, kind: it.kind ?? "download",
      interval: it.interval ?? null, plan_sites: it.sites ?? 0,
    });
  // Copy bundled deliverables for seeded products into the files directory.
  const seedDir = path.resolve("seed-files");
  if (fs.existsSync(seedDir)) {
    for (const f of fs.readdirSync(seedDir)) {
      const dest = path.join(FILES_DIR, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(seedDir, f), dest);
    }
  }
}

export function db() {
  if (!g.__db) g.__db = open();
  return g.__db;
}

// node:sqlite returns null-prototype rows; React can't pass those to client components.
function plain<T>(r: unknown): T {
  if (r == null) return r as T;
  if (Array.isArray(r)) return r.map((x) => ({ ...x })) as T;
  return { ...(r as object) } as T;
}

export const q = {
  userByEmail: (email: string) => plain<User | undefined>(db().prepare("SELECT * FROM users WHERE email = ?").get(email)),
  userById: (id: number) => plain<User | undefined>(db().prepare("SELECT * FROM users WHERE id = ?").get(id)),
  createUser: (email: string, name: string, hash: string, isAdmin: boolean) =>
    Number(db().prepare("INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)").run(email, name, hash, isAdmin ? 1 : 0).lastInsertRowid),
  products: (kind?: Product["kind"], includeInactive = false) =>
    plain<Product[]>(db().prepare(`SELECT * FROM products WHERE (? IS NULL OR kind = ?) ${includeInactive ? "" : "AND active = 1"} ORDER BY kind, price_cents`).all(kind ?? null, kind ?? null)),
  productBySlug: (slug: string) => plain<Product | undefined>(db().prepare("SELECT * FROM products WHERE slug = ?").get(slug)),
  productById: (id: number) => plain<Product | undefined>(db().prepare("SELECT * FROM products WHERE id = ?").get(id)),
  createOrder: (userId: number, productId: number, amount: number) =>
    Number(db().prepare("INSERT INTO orders (user_id, product_id, amount_cents) VALUES (?, ?, ?)").run(userId, productId, amount).lastInsertRowid),
  setOrderSession: (orderId: number, sessionId: string) =>
    db().prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(sessionId, orderId),
  orderById: (id: number) => plain<Order | undefined>(db().prepare("SELECT * FROM orders WHERE id = ?").get(id)),
  orderBySession: (sid: string) => plain<Order | undefined>(db().prepare("SELECT * FROM orders WHERE stripe_session_id = ?").get(sid)),
  /** Returns true only the first time an order is paid, so receipts are sent once. */
  markPaid: (orderId: number, license: string) =>
    Number(db().prepare("UPDATE orders SET status = 'paid', license_key = COALESCE(license_key, ?), paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ? AND status = 'pending'").run(license, orderId).changes) > 0,
  markRefunded: (sid: string) => db().prepare("UPDATE orders SET status = 'refunded' WHERE stripe_session_id = ?").run(sid),
  paidOrderFor: (userId: number, productId: number) =>
    plain<Order | undefined>(db().prepare("SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND status = 'paid'").get(userId, productId)),
  ordersForUser: (userId: number) =>
    plain<(Order & { product_name: string; product_slug: string; file_name: string | null; kind: string })[]>(db().prepare(`SELECT o.*, p.name AS product_name, p.slug AS product_slug, p.file_name AS file_name, p.kind AS kind FROM orders o JOIN products p ON p.id = o.product_id WHERE o.user_id = ? AND o.status = 'paid' ORDER BY o.id DESC`).all(userId)),
  allOrders: () =>
    plain<(Order & { product_name: string; email: string })[]>(db().prepare(`SELECT o.*, p.name AS product_name, u.email AS email FROM orders o JOIN products p ON p.id = o.product_id JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 200`).all()),
  stats: () =>
    plain<{ sales: number; revenue: number; customers: number; mrr: number }>(db().prepare(`SELECT COUNT(*) AS sales, COALESCE(SUM(amount_cents),0) AS revenue, (SELECT COUNT(*) FROM users) AS customers,
      (SELECT COALESCE(SUM(p.price_cents),0) FROM subscriptions s JOIN products p ON p.id = s.product_id WHERE s.status = 'active') AS mrr FROM orders WHERE status = 'paid'`).get()),
  // password resets
  createReset: (tokenHash: string, userId: number) => {
    db().prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < datetime('now')").run(userId);
    db().prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").run(tokenHash, userId);
  },
  validReset: (tokenHash: string) =>
    plain<{ user_id: number } | undefined>(db().prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')").get(tokenHash)),
  useReset: (tokenHash: string, userId: number, newHash: string) => {
    db().prepare("UPDATE password_resets SET used = 1 WHERE token_hash = ?").run(tokenHash);
    // Bumping session_version signs the user out everywhere else.
    db().prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?").run(newHash, userId);
  },
  // service projects
  createProject: (orderId: number, userId: number) =>
    db().prepare("INSERT OR IGNORE INTO projects (order_id, user_id) VALUES (?, ?)").run(orderId, userId),
  projectsForUser: (userId: number) =>
    plain<(Project & { product_name: string })[]>(db().prepare(`SELECT pr.*, p.name AS product_name FROM projects pr JOIN orders o ON o.id = pr.order_id JOIN products p ON p.id = o.product_id WHERE pr.user_id = ? ORDER BY pr.id DESC`).all(userId)),
  allProjects: () =>
    plain<(Project & { product_name: string; email: string })[]>(db().prepare(`SELECT pr.*, p.name AS product_name, u.email AS email FROM projects pr JOIN orders o ON o.id = pr.order_id JOIN products p ON p.id = o.product_id JOIN users u ON u.id = pr.user_id ORDER BY pr.id DESC`).all()),
  projectById: (id: number) =>
    plain<(Project & { product_name: string; email: string; customer_name: string }) | undefined>(db().prepare(`SELECT pr.*, p.name AS product_name, u.email AS email, u.name AS customer_name FROM projects pr JOIN orders o ON o.id = pr.order_id JOIN products p ON p.id = o.product_id JOIN users u ON u.id = pr.user_id WHERE pr.id = ?`).get(id)),
  setBrief: (id: number, brief: string) => db().prepare("UPDATE projects SET brief = ?, status = CASE WHEN status = 'intake' THEN 'design' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(brief, id),
  setProjectStatus: (id: number, status: string, liveUrl: string | null) =>
    db().prepare("UPDATE projects SET status = ?, live_url = COALESCE(?, live_url), updated_at = datetime('now') WHERE id = ?").run(status, liveUrl, id),
  projectMessages: (projectId: number) =>
    plain<{ id: number; body: string; created_at: string; name: string; is_admin: number }[]>(db().prepare(`SELECT m.id, m.body, m.created_at, u.name, u.is_admin FROM project_messages m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.id`).all(projectId)),
  addProjectMessage: (projectId: number, userId: number, body: string) =>
    db().prepare("INSERT INTO project_messages (project_id, user_id, body) VALUES (?, ?, ?)").run(projectId, userId, body),
  // course
  completedLessons: (userId: number) =>
    new Set(plain<{ lesson_slug: string }[]>(db().prepare("SELECT lesson_slug FROM lesson_progress WHERE user_id = ?").all(userId)).map((r) => r.lesson_slug)),
  setLessonDone: (userId: number, slug: string, done: boolean) =>
    done ? db().prepare("INSERT OR IGNORE INTO lesson_progress (user_id, lesson_slug) VALUES (?, ?)").run(userId, slug)
         : db().prepare("DELETE FROM lesson_progress WHERE user_id = ? AND lesson_slug = ?").run(userId, slug),
  hasPaidKind: (userId: number, kind: string) =>
    !!db().prepare("SELECT 1 FROM orders o JOIN products p ON p.id = o.product_id WHERE o.user_id = ? AND p.kind = ? AND o.status = 'paid'").get(userId, kind),
  // hosting
  upsertSubscription: (s: { user_id: number; product_id: number; status: string; stripe_subscription_id: string | null; current_period_end: string | null }) =>
    s.stripe_subscription_id && db().prepare("SELECT 1 FROM subscriptions WHERE stripe_subscription_id = ?").get(s.stripe_subscription_id)
      ? db().prepare("UPDATE subscriptions SET status = @status, product_id = @product_id, current_period_end = @current_period_end WHERE stripe_subscription_id = @stripe_subscription_id").run(s)
      : db().prepare("INSERT INTO subscriptions (user_id, product_id, status, stripe_subscription_id, current_period_end) VALUES (@user_id, @product_id, @status, @stripe_subscription_id, @current_period_end)").run(s),
  activePlan: (userId: number) =>
    plain<(Product & { sub_status: string; current_period_end: string | null }) | undefined>(db().prepare(`SELECT p.*, s.status AS sub_status, s.current_period_end FROM subscriptions s JOIN products p ON p.id = s.product_id WHERE s.user_id = ? AND s.status IN ('active', 'trialing') ORDER BY p.plan_sites DESC LIMIT 1`).get(userId)),
  olderActiveSubs: (userId: number) =>
    plain<{ id: number; stripe_subscription_id: string | null }[]>(db().prepare(`SELECT id, stripe_subscription_id FROM subscriptions WHERE user_id = ? AND status = 'active' AND id < (SELECT MAX(id) FROM subscriptions WHERE user_id = ? AND status = 'active')`).all(userId, userId)),
  cancelSubRow: (id: number) => db().prepare("UPDATE subscriptions SET status = 'canceled' WHERE id = ?").run(id),
  allSubscriptions: () =>
    plain<{ id: number; email: string; plan: string; status: string; price_cents: number; current_period_end: string | null }[]>(db().prepare(`SELECT s.id, u.email, p.name AS plan, s.status, p.price_cents, s.current_period_end FROM subscriptions s JOIN users u ON u.id = s.user_id JOIN products p ON p.id = s.product_id ORDER BY s.id DESC`).all()),
  sitesForUser: (userId: number) => plain<Site[]>(db().prepare("SELECT * FROM sites WHERE user_id = ? ORDER BY id").all(userId)),
  siteBySlug: (slug: string) => plain<Site | undefined>(db().prepare("SELECT * FROM sites WHERE slug = ?").get(slug)),
  createSite: (userId: number, slug: string, name: string) => db().prepare("INSERT INTO sites (user_id, slug, name) VALUES (?, ?, ?)").run(userId, slug, name),
  markDeployed: (id: number, files: number, bytes: number) =>
    db().prepare("UPDATE sites SET deployed_at = datetime('now'), file_count = ?, bytes = ? WHERE id = ?").run(files, bytes, id),
  deleteSite: (id: number) => db().prepare("DELETE FROM sites WHERE id = ?").run(id),
  upsertProduct: (p: { slug: string; name: string; tagline: string; description: string; price_cents: number; category: string; features: string; file_name: string | null; active: number; kind: string; interval: string | null; plan_sites: number }) =>
    db().prepare(`INSERT INTO products (slug, name, tagline, description, price_cents, category, features, file_name, active, kind, interval, plan_sites)
      VALUES (@slug, @name, @tagline, @description, @price_cents, @category, @features, @file_name, @active, @kind, @interval, @plan_sites)
      ON CONFLICT(slug) DO UPDATE SET name=@name, tagline=@tagline, description=@description, price_cents=@price_cents,
      category=@category, features=@features, file_name=COALESCE(@file_name, file_name), active=@active, plan_sites=@plan_sites`).run(p),
};
