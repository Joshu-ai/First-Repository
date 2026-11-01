import Link from "next/link";
import { posts } from "@/lib/data";

export const metadata = { title: "Blog" };

export default function Blog() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
      <p className="mt-2 text-muted">News, releases and notes from the team.</p>
      <ul className="mt-12 divide-y divide-line border-y border-line">
        {posts.map((p) => (
          <li key={p.slug}>
            <Link href={`/blog/${p.slug}`} className="group block py-6">
              <time className="text-xs text-muted">{new Date(p.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</time>
              <h2 className="mt-1 text-xl font-semibold group-hover:underline">{p.title}</h2>
              <p className="mt-1 text-muted">{p.summary}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
