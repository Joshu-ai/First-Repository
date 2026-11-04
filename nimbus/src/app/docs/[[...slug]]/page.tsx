import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { docGroups, docPages, flatDocNav } from "@/lib/data";
import { CodeBlock } from "@/components/CodeBlock";
import { DocsSidebar } from "./sidebar";
import { Toc } from "./toc";

type Props = { params: Promise<{ slug?: string[] }> };

export function generateStaticParams() {
  return docPages.map((p) => ({ slug: p.slug ? p.slug.split("/") : [] }));
}

async function find(params: Props["params"]) {
  const { slug } = await params;
  return docPages.find((p) => p.slug === (slug ?? []).join("/"));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await find(params);
  return p ? { title: p.title, description: p.description } : {};
}

export default async function DocPage({ params }: Props) {
  const p = await find(params);
  if (!p) notFound();
  const i = flatDocNav.findIndex((n) => n.slug === p.slug);
  const prev = flatDocNav[i - 1];
  const next = flatDocNav[i + 1];
  const href = (s: string) => `/docs${s ? "/" + s : ""}`;
  const group = docGroups.find((g) => g.items.some((it) => it.slug === p.slug));

  return (
    <div className="mx-auto flex max-w-7xl gap-10 px-4 md:px-6">
      <DocsSidebar groups={docGroups} />
      <article className="min-w-0 flex-1 py-10">
        <p className="mb-2 text-sm text-muted">{group?.title}</p>
        <h1 className="text-4xl font-bold tracking-tight">{p.title}</h1>
        <p className="mt-3 text-lg text-muted">{p.description}</p>
        <div className="prose-doc">
          {p.sections.map((s) => (
            <section key={s.id}>
              <h2 id={s.id}><a href={`#${s.id}`} className="hover:underline">{s.heading}</a></h2>
              {s.body.map((b, k) => <p key={k}>{b}</p>)}
              {s.code && <CodeBlock {...s.code} />}
            </section>
          ))}
        </div>
        <nav className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
          {prev ? (
            <Link href={href(prev.slug)} className="rounded-lg border border-line p-4 hover:bg-bg-soft">
              <span className="text-xs text-muted">Previous</span><div className="font-medium">{prev.title}</div>
            </Link>
          ) : <span />}
          {next && (
            <Link href={href(next.slug)} className="rounded-lg border border-line p-4 text-right hover:bg-bg-soft">
              <span className="text-xs text-muted">Next</span><div className="font-medium">{next.title}</div>
            </Link>
          )}
        </nav>
      </article>
      <Toc items={p.sections.map((s) => ({ id: s.id, heading: s.heading }))} />
    </div>
  );
}
