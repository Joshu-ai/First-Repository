// Change these to your own brand before launch.
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Nimbus",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "joshualef@duck.com",
  currency: "usd",
};
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: brand.currency.toUpperCase() }).format(cents / 100);

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}
