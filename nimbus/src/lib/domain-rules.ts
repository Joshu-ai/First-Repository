// Pure helpers for custom domains (no database or network), so they can run anywhere, including middleware.

// Common two-part public suffixes, so "shop.co.uk" counts as a root domain. Not exhaustive; anything else
// with exactly two labels is treated as a root domain too.
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "org.nz",
  "co.jp", "co.kr", "com.br", "com.mx", "com.ar", "co.za", "co.in", "net.in", "org.in", "com.sg", "com.hk",
  "com.tr", "com.cn", "com.tw", "co.il", "com.my", "com.ph", "com.ng", "co.id", "com.co", "com.pe", "com.ua",
]);

/** Lowercases and strips a pasted URL down to its host. Returns null if it isn't a usable domain name. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (d.length > 253 || !d.includes(".")) return null;
  const labels = d.split(".");
  if (labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return null; // an IP address, not a domain
  return d;
}

/** The registrable root of a domain, e.g. "shop.example.com" -> "example.com", "a.b.co.uk" -> "b.co.uk". */
export function rootOf(domain: string) {
  const labels = domain.split(".");
  const n = labels.length >= 3 && TWO_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-n).join(".");
}

export const isApex = (domain: string) => rootOf(domain) === domain;

/** True if `host` is `domain` or a subdomain of it. */
export const within = (host: string, domain: string) => !!domain && (host === domain || host.endsWith(`.${domain}`));

/** "_nimbus-verify" for the brand "Nimbus". The TXT record that proves a customer owns a domain lives here. */
export const verifyLabel = (brandName: string) => `_${brandName.toLowerCase().replace(/[^a-z0-9]/g, "") || "site"}-verify`;

export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; host: string; value: string; purpose: string; optional?: boolean };

/**
 * The records a customer adds at their DNS provider. `name` is relative to their root domain ("@" for the root),
 * which is what most providers ask for; `host` is the full name, for providers that want that instead.
 */
export function recordsFor(domain: string, opts: { target: string; ips: string[]; token: string; brand: string }): DnsRecord[] {
  const root = rootOf(domain);
  const rel = (h: string) => (h === root ? "@" : h.slice(0, -(root.length + 1)));
  const txtHost = `${verifyLabel(opts.brand)}.${domain}`;
  const out: DnsRecord[] = [];
  if (isApex(domain)) {
    for (const ip of opts.ips) out.push({ type: "A", name: "@", host: domain, value: ip, purpose: "Points your domain at your site" });
    out.push({ type: "CNAME", name: "www", host: `www.${domain}`, value: opts.target, purpose: `Sends www.${domain} to ${domain}`, optional: true });
  } else {
    out.push({ type: "CNAME", name: rel(domain), host: domain, value: opts.target, purpose: "Points your domain at your site" });
  }
  out.push({ type: "TXT", name: rel(txtHost), host: txtHost, value: `${verifyLabel(opts.brand).slice(1)}=${opts.token}`, purpose: "Proves you own the domain" });
  return out;
}
