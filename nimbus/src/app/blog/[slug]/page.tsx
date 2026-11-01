import Link from "next/link";
import { notFound } from "next/navigation";
import { posts } from "@/lib/data";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return posts.map((p) => ({ slug: p.slug })); }
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const p = posts.find((x) => x.slug === slug);
  return p ? { title: p.title } : {};
}

export default async function Post({ params }: Props) {
  const { slug } = await params;
  const p = posts.find((x) => x.slug === slug);
  if (!p) notFound();
  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/blog" className="text-sm text-muted hover:text-fg">← Back to Blog</Link>
      <time className="mt-8 block text-sm text-muted">{p.date}</time>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">{p.title}</h1>
      <p className="mt-4 text-sm text-muted">By {p.author}</p>
      <div className="prose-doc mt-10">
        <p>{p.summary} This is placeholder body text for the demo site; swap it for real posts from a CMS or MDX files.</p>
        <h2 id="highlights">Highlights</h2>
        <ul><li>A placeholder improvement to build speed.</li><li>A placeholder new API for data loading.</li><li>A placeholder fix to the dev server.</li></ul>
        <h2 id="upgrade">How to upgrade</h2>
        <p>Run the upgrade command in your project, then follow any notes printed in the terminal.</p>
      </div>
    </article>
  );
}
