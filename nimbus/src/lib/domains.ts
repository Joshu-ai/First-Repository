import "server-only";
import { promises as dns } from "node:dns";
import { brand, siteUrl } from "./brand";
import { q, type Domain } from "./db";
import { sendEmail } from "./email";
import { hostingDomain } from "./hosting";
import { recordsFor, rootOf, verifyLabel, within } from "./domain-rules";

/**
 * Custom domains: a customer points their own domain at a hosted site.
 *
 * - Subdomains (shop.example.com) use a CNAME to CUSTOM_DOMAIN_TARGET.
 * - Root domains (example.com) can't use a CNAME, so they use A records to CUSTOM_DOMAIN_IPS.
 * - A TXT record proves they own the domain, so nobody can claim a domain whose DNS happens to point here.
 * Once both check out the domain goes "active": the app serves the site on it, and the TLS proxy (Caddy, see
 * deploy/Caddyfile) is allowed to fetch a certificate for it via /api/domains/allow.
 */

/** The hostname customers CNAME to. Defaults to cname.<HOSTING_DOMAIN>, which the wildcard record already covers. */
export function cnameTarget() {
  const t = (process.env.CUSTOM_DOMAIN_TARGET || "").trim().toLowerCase().replace(/\.$/, "");
  if (t) return t;
  const h = hostingDomain();
  return h ? `cname.${h}` : "";
}

export const customDomainsEnabled = () => !!cnameTarget();

const resolver = () => {
  const r = new dns.Resolver({ timeout: 4000, tries: 2 });
  const servers = (process.env.DNS_SERVERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (servers.length) r.setServers(servers);
  return r;
};

let ipCache: { at: number; ips: string[] } | null = null;

/** IPv4 addresses root domains should point at: CUSTOM_DOMAIN_IPS, or whatever the CNAME target resolves to. */
export async function serverIps(): Promise<string[]> {
  const env = (process.env.CUSTOM_DOMAIN_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.length) return env;
  if (ipCache && Date.now() - ipCache.at < 10 * 60_000) return ipCache.ips;
  const target = cnameTarget();
  const ips = target ? await resolver().resolve4(target).catch(() => [] as string[]) : [];
  ipCache = { at: Date.now(), ips };
  return ips;
}

export async function dnsRecords(d: Pick<Domain, "host" | "token">) {
  return recordsFor(d.host, { target: cnameTarget(), ips: await serverIps(), token: d.token, brand: brand.name });
}

/** Domains customers may not connect: ours, and anything under them. */
export function reservedDomain(host: string) {
  const main = new URL(siteUrl()).hostname.toLowerCase();
  const ours = [hostingDomain(), rootOf(main), main, cnameTarget()].filter(Boolean);
  return ours.some((d) => within(host, d) || within(d, host));
}

const missing = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  return code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN";
};

export type CheckResult = { ownership: boolean; routing: boolean; error: string | null };

/** Looks up the domain's DNS and reports whether ownership and routing are both set up. */
export async function inspect(d: Pick<Domain, "host" | "token">): Promise<CheckResult> {
  const r = resolver();
  const target = cnameTarget();
  const problems: string[] = [];

  let ownership = false;
  const expected = `${verifyLabel(brand.name).slice(1)}=${d.token}`;
  try {
    const txt = (await r.resolveTxt(`${verifyLabel(brand.name)}.${d.host}`)).map((parts) => parts.join(""));
    ownership = txt.some((t) => t.trim() === expected);
    if (!ownership) problems.push("The TXT record is there but its value doesn't match. Copy it again exactly.");
  } catch (e) {
    problems.push(missing(e) ? "We can't see the TXT record yet." : "We couldn't look up the TXT record. We'll try again shortly.");
  }

  let routing = false;
  try {
    const cnames = await r.resolveCname(d.host).catch(() => [] as string[]);
    if (cnames.some((c) => c.toLowerCase().replace(/\.$/, "") === target)) routing = true;
    else {
      const [have, ours] = await Promise.all([r.resolve4(d.host), serverIps()]);
      routing = have.length > 0 && ours.length > 0 && have.every((ip) => ours.includes(ip));
      if (!routing) {
        problems.push(
          `${d.host} points at ${have.join(", ")}, not at your site yet. If you use Cloudflare, set the record to "DNS only" (grey cloud).`,
        );
      }
    }
  } catch (e) {
    problems.push(missing(e) ? `We can't see a record for ${d.host} yet.` : `We couldn't look up ${d.host}. We'll try again shortly.`);
  }

  return { ownership, routing, error: ownership && routing ? null : `${problems.join(" ")} DNS changes can take up to an hour to show up.` };
}

/** Checks a domain, saves the result, and emails the owner the moment it goes live. */
export async function checkDomain(d: Domain): Promise<CheckResult> {
  const res = await inspect(d);
  const nowActive = res.ownership && res.routing;
  q.setDomainCheck(d.id, nowActive, res.error);
  if (nowActive && d.status !== "active") {
    const site = q.siteById(d.site_id);
    const owner = site ? q.userById(site.user_id) : undefined;
    if (owner) {
      await sendEmail({
        to: owner.email,
        subject: `${d.host} is connected`,
        heading: `${d.host} is live`,
        lines: [
          `Your site "${site!.name}" is now served at https://${d.host}.`,
          "The secure certificate is issued on the first visit, so the very first load can take a few extra seconds.",
        ],
        button: { label: "Visit your site", href: `https://${d.host}/` },
      });
    }
  }
  return res;
}

/** Rechecks pending domains in the background so customers don't have to keep pressing "Check now". */
export async function recheckPending() {
  if (!customDomainsEnabled()) return;
  for (const d of q.domainsToRecheck()) await checkDomain(d).catch(() => {});
}

