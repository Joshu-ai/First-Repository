// All site copy lives here so the brand, prices and contact details
// can be changed without touching layout code.

export const site = {
  name: "Nimbus",
  tagline: "Websites built like software",
  description:
    "Nimbus designs and builds fast, maintainable websites and web apps for small teams. Fixed scope, weekly demos, and code you own.",
  email: "joshualef@duck.com",
  bookingUrl: "#contact",
};

export const nav = [
  { label: "Services", href: "#services" },
  { label: "Process", href: "#process" },
  { label: "Work", href: "#work" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export const buildLog = [
  { cmd: "brief", out: "Goals, audience and pages agreed", when: "Day 1" },
  { cmd: "design", out: "Clickable prototype approved", when: "Week 1" },
  { cmd: "build", out: "Next.js site on a private preview link", when: "Week 2" },
  { cmd: "test", out: "Lighthouse 98, accessible, checked on mobile", when: "Week 3" },
  { cmd: "launch", out: "Live on your domain", when: "Week 3" },
];

export const services = [
  {
    title: "Marketing sites",
    body: "Fast landing pages and company sites that load in under a second and are easy for your team to update.",
  },
  {
    title: "Web apps",
    body: "Dashboards, portals and internal tools with sign-in, payments and a real database behind them.",
  },
  {
    title: "Online stores",
    body: "Headless storefronts on Shopify or Stripe with product pages tuned for search and conversion.",
  },
  {
    title: "Redesigns and rebuilds",
    body: "Move an ageing WordPress or Wix site to a modern stack without losing your search rankings.",
  },
  {
    title: "Performance and SEO",
    body: "Audit Core Web Vitals, fix what is slow, and add the structured data search engines read.",
  },
  {
    title: "Care plans",
    body: "Monthly updates, uptime monitoring and small changes, handled within two business days.",
  },
];

export const process = [
  {
    title: "Scope",
    body: "A 30-minute call, then a written plan with pages, features, timeline and a fixed price.",
  },
  {
    title: "Design",
    body: "A clickable prototype you can test on your phone before any production code is written.",
  },
  {
    title: "Build",
    body: "Weekly demos on a private preview link. You comment directly on the page you are viewing.",
  },
  {
    title: "Launch",
    body: "Domain, analytics and hand-off docs. The code lives in your GitHub account from day one.",
  },
];

// Sample projects: replace with real case studies before launch.
export const work = [
  {
    name: "Harbor Coffee",
    kind: "Online store",
    result: "Checkout time cut from 4 minutes to 70 seconds",
    hue: 28,
  },
  {
    name: "Fieldnote",
    kind: "Web app",
    result: "Booking portal serving 3,000 clinics",
    hue: 160,
  },
  {
    name: "Northline Legal",
    kind: "Marketing site",
    result: "Organic leads up 2.4× in six months",
    hue: 220,
  },
];

export const plans = [
  {
    name: "Launch",
    price: "$2,500",
    note: "one-off",
    summary: "A focused site for a new business or product.",
    features: [
      "Up to 5 pages",
      "Custom design",
      "Contact form and analytics",
      "Edit content yourself",
      "Live in 2 weeks",
    ],
    cta: "Start a Launch project",
  },
  {
    name: "Growth",
    price: "$6,000",
    note: "one-off",
    summary: "A full site or small web app for a growing team.",
    features: [
      "Up to 15 pages or 3 app screens",
      "Blog, CMS or store",
      "Sign-in and payments",
      "SEO and performance audit",
      "Live in 4 to 6 weeks",
    ],
    cta: "Start a Growth project",
    featured: true,
  },
  {
    name: "Care",
    price: "$300",
    note: "per month",
    summary: "Ongoing updates for any site, including ones I did not build.",
    features: [
      "Up to 6 hours of changes",
      "Uptime and error monitoring",
      "Dependency and security updates",
      "Monthly performance report",
    ],
    cta: "Ask about Care",
  },
];

export const faq = [
  {
    q: "Do I own the code?",
    a: "Yes. The repository is created in your GitHub account and you have full access from the first commit.",
  },
  {
    q: "Can I edit the site myself after launch?",
    a: "Yes. Text, images and blog posts are editable through a simple CMS. You will get a short video showing how.",
  },
  {
    q: "Where is the site hosted?",
    a: "Usually on Vercel or Netlify, under your own account. Hosting for most small sites is free or a few dollars a month.",
  },
  {
    q: "What if the project needs more than the plan covers?",
    a: "Anything outside the written scope is quoted separately before work starts. There are no surprise invoices.",
  },
];
