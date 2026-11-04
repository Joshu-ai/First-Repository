import { q, type Site } from "@/lib/db";
import { customDomainsEnabled, dnsRecords } from "@/lib/domains";
import { removeDomain } from "@/lib/domain-actions";
import { CheckDomainButton, ConnectDomainForm, CopyValue } from "./forms";

/** "Custom domain" block under each hosted site: connect, see the DNS records to add, check, remove. */
export async function DomainPanel({ site }: { site: Site }) {
  if (!customDomainsEnabled()) return null;
  const d = q.domainForSite(site.id);
  if (!d) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-sm font-medium">Custom domain</p>
        <p className="mb-3 text-xs text-muted">Use a domain you own, like example.com or shop.example.com. Free HTTPS is included.</p>
        <ConnectDomainForm slug={site.slug} />
      </div>
    );
  }
  const records = await dnsRecords(d);
  const remove = (
    <form action={removeDomain}>
      <input type="hidden" name="id" value={d.id} />
      <button className="text-xs text-red-600 hover:underline dark:text-red-400">Remove domain</button>
    </form>
  );
  if (d.status === "active") {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-sm font-medium">Custom domain</p>
          <p className="mt-1 text-sm">
            <span className="mr-2 rounded-full bg-green-600/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">Connected</span>
            <a href={`https://${d.host}/`} target="_blank" rel="noreferrer" className="text-accent underline">{d.host}</a>
            <span className="ml-2 text-xs text-muted">HTTPS on · since {d.verified_at?.slice(0, 10)}</span>
          </p>
        </div>
        {remove}
      </div>
    );
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          Custom domain: {d.host}
          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Waiting for DNS</span>
        </p>
        {remove}
      </div>
      <p className="mt-2 text-xs text-muted">
        Sign in where you bought {d.host} (GoDaddy, Namecheap, Cloudflare, Google/Squarespace Domains...), open its DNS settings and add
        these records. Remove any other A or CNAME record for the same name first. We check automatically every few minutes.
      </p>
      <div className="mt-3 overflow-x-auto rounded-md border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-soft text-xs text-muted">
            <tr><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Name / Host</th><th className="px-3 py-2 font-medium">Value / Points to</th><th className="hidden px-3 py-2 font-medium sm:table-cell">What it does</th></tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={`${r.type}${r.host}${r.value}`} className="border-t border-line align-top">
                <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                <td className="px-3 py-2"><CopyValue value={r.name} /><span className="mt-1 block text-[10px] text-muted">{r.host}</span></td>
                <td className="px-3 py-2"><CopyValue value={r.value || "(not configured)"} /></td>
                <td className="hidden px-3 py-2 text-xs text-muted sm:table-cell">{r.purpose}{r.optional ? " (optional)" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.last_error && <p className="mt-3 text-xs text-muted">Last check {d.checked_at}: {d.last_error}</p>}
      <div className="mt-3"><CheckDomainButton id={d.id} /></div>
    </div>
  );
}
