// The data model for sites made in the Nimbus website builder. Shared by the editor (client) and publisher (server).

export type Link = { label: string; href: string };
export type Tone = "light" | "muted" | "dark" | "accent";
// Section data is a loose JSON object; each section type's spec describes its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = Record<string, any>;

export type Section = { id: string; type: string; tone: Tone; data: Data };
export type Page = { id: string; title: string; slug: string; sections: Section[] };
export type Theme = { palette: string; font: string; shape: "square" | "soft" | "round" };
export type SiteDoc = {
  v: 1;
  name: string;
  theme: Theme;
  nav: { cta: Link };
  footer: { text: string; email: string; phone: string; address: string; instagram: string; facebook: string; linkedin: string };
  pages: Page[];
};

export type Palette = { id: string; name: string; bg: string; surface: string; text: string; muted: string; accent: string; onAccent: string; dark: string; onDark: string; line: string };

export const PALETTES: Palette[] = [
  { id: "paper", name: "Paper", bg: "#fbf8f3", surface: "#f2ece2", text: "#1f1b16", muted: "#6b6258", accent: "#c4572e", onAccent: "#ffffff", dark: "#1f1b16", onDark: "#f6efe4", line: "#e3d9cb" },
  { id: "harbor", name: "Harbor", bg: "#ffffff", surface: "#eef3f8", text: "#0f2133", muted: "#56687a", accent: "#1d5fa8", onAccent: "#ffffff", dark: "#0f2133", onDark: "#e8f0f8", line: "#d8e2ec" },
  { id: "sage", name: "Sage", bg: "#f7f8f4", surface: "#e8ede2", text: "#1e2a1f", muted: "#5d6b5e", accent: "#4f7a55", onAccent: "#ffffff", dark: "#223325", onDark: "#eef3ea", line: "#d6dfd0" },
  { id: "midnight", name: "Midnight", bg: "#0e0f13", surface: "#181a21", text: "#f1f1f4", muted: "#9a9cab", accent: "#d9b36c", onAccent: "#15130e", dark: "#000000", onDark: "#f1f1f4", line: "#2a2d38" },
  { id: "blush", name: "Blush", bg: "#fdf8f6", surface: "#f7e9e4", text: "#3a2420", muted: "#80655f", accent: "#b85c6b", onAccent: "#ffffff", dark: "#3a2420", onDark: "#fbeee9", line: "#eedad3" },
  { id: "citrus", name: "Citrus", bg: "#ffffff", surface: "#f4f6ec", text: "#111111", muted: "#5a5a5a", accent: "#d4f04a", onAccent: "#111111", dark: "#111111", onDark: "#f5f5f5", line: "#e4e6da" },
  { id: "mono", name: "Mono", bg: "#ffffff", surface: "#f4f4f5", text: "#09090b", muted: "#63636b", accent: "#09090b", onAccent: "#ffffff", dark: "#09090b", onDark: "#fafafa", line: "#e4e4e7" },
  { id: "forest", name: "Forest", bg: "#fcfbf7", surface: "#efeee6", text: "#14231c", muted: "#5b665f", accent: "#1f5c45", onAccent: "#ffffff", dark: "#12291f", onDark: "#e9f0ea", line: "#dedcd0" },
];

export type FontPair = { id: string; name: string; heading: string; body: string; headingWeight: number; google: string };

export const FONTS: FontPair[] = [
  { id: "modern", name: "Modern", heading: "Inter", body: "Inter", headingWeight: 700, google: "family=Inter:wght@400;500;600;700" },
  { id: "editorial", name: "Editorial", heading: "Fraunces", body: "Inter", headingWeight: 600, google: "family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600" },
  { id: "classic", name: "Classic", heading: "Playfair Display", body: "Source Sans 3", headingWeight: 600, google: "family=Playfair+Display:wght@500;600&family=Source+Sans+3:wght@400;600" },
  { id: "geometric", name: "Geometric", heading: "Space Grotesk", body: "Inter", headingWeight: 600, google: "family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500" },
  { id: "friendly", name: "Friendly", heading: "Poppins", body: "Nunito Sans", headingWeight: 700, google: "family=Poppins:wght@600;700&family=Nunito+Sans:wght@400;600" },
  { id: "elegant", name: "Elegant", heading: "Cormorant Garamond", body: "Lato", headingWeight: 600, google: "family=Cormorant+Garamond:wght@500;600&family=Lato:wght@400;700" },
];

export const palette = (id: string) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];
export const fontPair = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Turns any text into a URL-safe slug. */
export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
