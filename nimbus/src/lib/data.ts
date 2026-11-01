// All content below is original placeholder content for the "Nimbus" demo brand.

export type DocPage = {
  slug: string; // path after /docs, "" for the index
  title: string;
  description: string;
  sections: { id: string; heading: string; body: string[]; code?: { file?: string; lang: string; source: string } }[];
};

export type DocGroup = { title: string; items: { title: string; slug: string }[] };

const lorem = (topic: string) => [
  `This page explains how ${topic} works in Nimbus, with a short overview first and practical examples after.`,
  `Each concept builds on the previous section, so you can read top to bottom or jump straight to what you need using the outline on the right.`,
];

function page(slug: string, title: string, description: string, topics: string[], code?: DocPage["sections"][0]["code"]): DocPage {
  return {
    slug,
    title,
    description,
    sections: topics.map((t, i) => ({
      id: t.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      heading: t,
      body: lorem(t.toLowerCase()),
      code: i === 0 ? code : undefined,
    })),
  };
}

export const docGroups: DocGroup[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", slug: "" },
      { title: "Installation", slug: "getting-started/installation" },
      { title: "Project Structure", slug: "getting-started/project-structure" },
      { title: "Layouts and Pages", slug: "getting-started/layouts-and-pages" },
      { title: "Fetching Data", slug: "getting-started/fetching-data" },
      { title: "Styling", slug: "getting-started/styling" },
      { title: "Deploying", slug: "getting-started/deploying" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Authentication", slug: "guides/authentication" },
      { title: "Caching", slug: "guides/caching" },
      { title: "Environment Variables", slug: "guides/environment-variables" },
      { title: "Internationalization", slug: "guides/internationalization" },
      { title: "Testing", slug: "guides/testing" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { title: "Components", slug: "api-reference/components" },
      { title: "File Conventions", slug: "api-reference/file-conventions" },
      { title: "Functions", slug: "api-reference/functions" },
      { title: "Configuration", slug: "api-reference/configuration" },
      { title: "CLI", slug: "api-reference/cli" },
    ],
  },
];

const install = { file: "Terminal", lang: "bash", source: "npx create-nimbus-app@latest my-app\ncd my-app\nnpm run dev" };
const routeCode = {
  file: "app/page.tsx",
  lang: "tsx",
  source: `export default async function Page() {\n  const items = await getItems()\n  return <List items={items} />\n}`,
};

export const docPages: DocPage[] = docGroups.flatMap((g) =>
  g.items.map((it) =>
    it.slug === ""
      ? page("", "Introduction", "Welcome to the Nimbus documentation.", ["What is Nimbus?", "How to use these docs", "Prerequisites", "Next steps"], install)
      : page(it.slug, it.title, `Learn about ${it.title.toLowerCase()} in Nimbus.`, ["Overview", "Usage", "Examples", "Good to know"], it.slug.startsWith("getting-started/installation") ? install : routeCode),
  ),
);

export const flatDocNav = docGroups.flatMap((g) => g.items);

export type Post = { slug: string; title: string; date: string; summary: string; author: string };
export const posts: Post[] = Array.from({ length: 14 }, (_, i) => {
  const minor = 14 - i;
  const kinds = ["Nimbus 4." + minor, "Inside the build pipeline, part " + (i + 1), "Security notice " + (2026 - Math.floor(i / 4)) + "-" + (i + 1), "Community update #" + (40 - i)];
  const title = kinds[i % 4];
  const d = new Date(Date.UTC(2026, 9, 28) - i * 21 * 864e5);
  return {
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, ""),
    title,
    date: d.toISOString().slice(0, 10),
    summary: i % 4 === 0 ? "Faster builds, a smaller runtime and a handful of new APIs." : "Notes from the team on what changed and why.",
    author: ["A. Rivera", "K. Okafor", "M. Lindqvist", "S. Patel"][i % 4],
  };
});

export const showcaseCategories = ["All", "Commerce", "Web Apps", "AI", "Media", "Platform"] as const;
export type ShowcaseItem = { id: number; name: string; category: Exclude<(typeof showcaseCategories)[number], "All">; url: string; hue: number };
const names = ["Lumen", "Orbitly", "Fernwood", "Quill & Co", "Parcelia", "Tidepool", "Kitebase", "Northstar", "Cobalt Labs", "Mosaic", "Driftwave", "Ember", "Pinecone Supply", "Halcyon", "Atlas Notes", "Verdant", "Signalroom", "Brightloop", "Copperline", "Nimbus Cloud"];
export const showcase: ShowcaseItem[] = names.map((name, i) => ({
  id: i + 1,
  name,
  category: (["Commerce", "Web Apps", "AI", "Media", "Platform"] as const)[i % 5],
  url: "#",
  hue: (i * 47) % 360,
}));

export const templates = [
  { title: "Starter Kit", description: "A minimal app with routing, styling and linting configured.", repo: "nimbus/starter" },
  { title: "Commerce", description: "A storefront with product pages, cart and checkout flow.", repo: "nimbus/commerce" },
  { title: "AI Chat", description: "A streaming chat interface with a pluggable model backend.", repo: "nimbus/ai-chat" },
  { title: "Blog", description: "Markdown posts, RSS and open-graph images out of the box.", repo: "nimbus/blog" },
];

export type SearchHit = { title: string; href: string; section: string };
export function searchIndex(): SearchHit[] {
  return [
    ...docPages.flatMap((p) => [
      { title: p.title, href: `/docs${p.slug ? "/" + p.slug : ""}`, section: "Docs" },
      ...p.sections.map((s) => ({ title: `${p.title} › ${s.heading}`, href: `/docs${p.slug ? "/" + p.slug : ""}#${s.id}`, section: "Docs" })),
    ]),
    ...posts.map((p) => ({ title: p.title, href: `/blog/${p.slug}`, section: "Blog" })),
    { title: "Showcase", href: "/showcase", section: "Pages" },
    { title: "Templates", href: "/templates", section: "Pages" },
    { title: "Learn", href: "/learn", section: "Pages" },
  ];
}
