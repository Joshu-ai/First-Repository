import type { Data } from "./types";

// Each section type declares its editable fields. The editor builds its inspector form from these specs,
// so adding a new section type means adding a spec here and a renderer in render.ts.

export type Field =
  | { key: string; label: string; kind: "text" | "textarea" | "image" | "link" | "toggle" }
  | { key: string; label: string; kind: "select"; options: [string, string][] }
  | { key: string; label: string; kind: "list"; itemLabel: string; item: Field[]; newItem: Data };

export type SectionSpec = { type: string; label: string; description: string; group: string; fields: Field[]; defaults: Data };

export const ICONS: Record<string, string> = {
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  leaf: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  pin: "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  chat: "M4 5h16v11H9l-5 4z",
  check: "M4 12l5 5L20 6",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  cup: "M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};
const iconOptions = Object.keys(ICONS).map((k) => [k, k[0].toUpperCase() + k.slice(1)] as [string, string]);
const cols: [string, string][] = [["2", "2 columns"], ["3", "3 columns"], ["4", "4 columns"]];
const link = (label: string, href: string) => ({ label, href });

export const SECTIONS: SectionSpec[] = [
  {
    type: "hero", label: "Hero", group: "Intro", description: "A big headline with buttons and an image.",
    fields: [
      { key: "layout", label: "Layout", kind: "select", options: [["centered", "Centered"], ["split", "Text + image"], ["cover", "Full-width image"]] },
      { key: "eyebrow", label: "Small label", kind: "text" },
      { key: "heading", label: "Headline", kind: "text" },
      { key: "text", label: "Text", kind: "textarea" },
      { key: "primary", label: "Main button", kind: "link" },
      { key: "secondary", label: "Second button", kind: "link" },
      { key: "image", label: "Image", kind: "image" },
    ],
    defaults: { layout: "split", eyebrow: "Welcome", heading: "A headline that says what you do", text: "One or two sentences about who you help and why they should pick you.", primary: link("Get started", "#contact"), secondary: link("Learn more", "#"), image: "ph:1" },
  },
  {
    type: "features", label: "Features", group: "Content", description: "A grid of cards with icons.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "intro", label: "Intro", kind: "textarea" },
      { key: "columns", label: "Columns", kind: "select", options: cols },
      { key: "items", label: "Cards", kind: "list", itemLabel: "Card", newItem: { icon: "star", title: "New feature", text: "Describe it in a sentence." },
        item: [{ key: "icon", label: "Icon", kind: "select", options: iconOptions }, { key: "title", label: "Title", kind: "text" }, { key: "text", label: "Text", kind: "textarea" }] },
    ],
    defaults: { heading: "Why people choose us", intro: "", columns: "3", items: [
      { icon: "bolt", title: "Fast", text: "We get back to you the same day." },
      { icon: "heart", title: "Friendly", text: "Real people who care about the details." },
      { icon: "shield", title: "Reliable", text: "Ten years of happy customers." },
    ] },
  },
  {
    type: "imageText", label: "Image + text", group: "Content", description: "A picture beside a block of text.",
    fields: [
      { key: "eyebrow", label: "Small label", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "text", label: "Text", kind: "textarea" },
      { key: "button", label: "Button", kind: "link" },
      { key: "image", label: "Image", kind: "image" },
      { key: "side", label: "Image side", kind: "select", options: [["left", "Left"], ["right", "Right"]] },
    ],
    defaults: { eyebrow: "Our story", heading: "Tell people who you are", text: "Share where you started, what you believe in, and what makes your work different.\n\nKeep it short and personal.", button: link("", ""), image: "ph:2", side: "left" },
  },
  {
    type: "text", label: "Text", group: "Content", description: "A heading and paragraphs.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "text", label: "Text", kind: "textarea" },
      { key: "align", label: "Alignment", kind: "select", options: [["left", "Left"], ["center", "Center"]] },
    ],
    defaults: { heading: "A short heading", text: "Write anything here. Press Enter twice for a new paragraph.", align: "center" },
  },
  {
    type: "gallery", label: "Gallery", group: "Media", description: "A grid of photos with captions.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "intro", label: "Intro", kind: "textarea" },
      { key: "columns", label: "Columns", kind: "select", options: cols },
      { key: "items", label: "Photos", kind: "list", itemLabel: "Photo", newItem: { image: "ph:3", caption: "" },
        item: [{ key: "image", label: "Image", kind: "image" }, { key: "caption", label: "Caption", kind: "text" }] },
    ],
    defaults: { heading: "Recent work", intro: "", columns: "3", items: [1, 2, 3, 4, 5, 6].map((n) => ({ image: `ph:${n}`, caption: "" })) },
  },
  {
    type: "testimonials", label: "Testimonials", group: "Social proof", description: "Quotes from happy customers.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "items", label: "Quotes", kind: "list", itemLabel: "Quote", newItem: { quote: "They were wonderful to work with.", name: "Customer name", role: "" },
        item: [{ key: "quote", label: "Quote", kind: "textarea" }, { key: "name", label: "Name", kind: "text" }, { key: "role", label: "Role or city", kind: "text" }] },
    ],
    defaults: { heading: "Kind words", items: [
      { quote: "Exactly what we needed, and easier than we expected.", name: "Sam Rivera", role: "Portland" },
      { quote: "Thoughtful, quick and great to work with. We'll be back.", name: "Priya Shah", role: "Austin" },
    ] },
  },
  {
    type: "logos", label: "Logo strip", group: "Social proof", description: "Names of clients or press.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "items", label: "Names", kind: "list", itemLabel: "Name", newItem: { name: "Company" }, item: [{ key: "name", label: "Name", kind: "text" }] },
    ],
    defaults: { heading: "As seen in", items: ["Northwind", "Lumen", "Atlas & Co", "Brightside", "Kestrel"].map((name) => ({ name })) },
  },
  {
    type: "stats", label: "Numbers", group: "Social proof", description: "Big numbers that build trust.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "items", label: "Numbers", kind: "list", itemLabel: "Number", newItem: { value: "100+", label: "Something" },
        item: [{ key: "value", label: "Number", kind: "text" }, { key: "label", label: "Label", kind: "text" }] },
    ],
    defaults: { heading: "", items: [{ value: "12 yrs", label: "In business" }, { value: "900+", label: "Happy customers" }, { value: "4.9★", label: "Average review" }] },
  },
  {
    type: "pricing", label: "Pricing", group: "Selling", description: "Plans or packages side by side.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "intro", label: "Intro", kind: "textarea" },
      { key: "items", label: "Plans", kind: "list", itemLabel: "Plan", newItem: { name: "New plan", price: "$49", period: "/mo", description: "", features: "One feature\nAnother feature", button: link("Choose", "#contact"), featured: false },
        item: [
          { key: "name", label: "Name", kind: "text" }, { key: "price", label: "Price", kind: "text" }, { key: "period", label: "Period", kind: "text" },
          { key: "description", label: "Description", kind: "text" }, { key: "features", label: "Features (one per line)", kind: "textarea" },
          { key: "button", label: "Button", kind: "link" }, { key: "featured", label: "Highlight this plan", kind: "toggle" },
        ] },
    ],
    defaults: { heading: "Simple pricing", intro: "", items: [
      { name: "Basic", price: "$29", period: "/mo", description: "For getting started.", features: "Feature one\nFeature two", button: link("Choose Basic", "#contact"), featured: false },
      { name: "Plus", price: "$59", period: "/mo", description: "Our most popular plan.", features: "Everything in Basic\nFeature three\nFeature four", button: link("Choose Plus", "#contact"), featured: true },
      { name: "Pro", price: "$99", period: "/mo", description: "For busy teams.", features: "Everything in Plus\nPriority support", button: link("Choose Pro", "#contact"), featured: false },
    ] },
  },
  {
    type: "menu", label: "Menu / price list", group: "Selling", description: "Items with descriptions and prices, grouped by category.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "intro", label: "Intro", kind: "textarea" },
      { key: "items", label: "Items", kind: "list", itemLabel: "Item", newItem: { category: "", name: "New item", description: "", price: "$10" },
        item: [{ key: "category", label: "Category", kind: "text" }, { key: "name", label: "Name", kind: "text" }, { key: "description", label: "Description", kind: "text" }, { key: "price", label: "Price", kind: "text" }] },
    ],
    defaults: { heading: "Menu", intro: "", items: [
      { category: "Starters", name: "Seasonal soup", description: "Ask us what's in the pot today.", price: "$9" },
      { category: "Starters", name: "Garden salad", description: "Greens, herbs, lemon dressing.", price: "$11" },
      { category: "Mains", name: "Roast chicken", description: "Potatoes, greens, pan sauce.", price: "$24" },
    ] },
  },
  {
    type: "team", label: "Team", group: "Content", description: "Photos, names and roles.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "intro", label: "Intro", kind: "textarea" },
      { key: "items", label: "People", kind: "list", itemLabel: "Person", newItem: { image: "ph:4", name: "Name", role: "Role" },
        item: [{ key: "image", label: "Photo", kind: "image" }, { key: "name", label: "Name", kind: "text" }, { key: "role", label: "Role", kind: "text" }] },
    ],
    defaults: { heading: "Meet the team", intro: "", items: [{ image: "ph:4", name: "Alex Morgan", role: "Founder" }, { image: "ph:5", name: "Jordan Lee", role: "Lead designer" }, { image: "ph:6", name: "Casey Kim", role: "Customer care" }] },
  },
  {
    type: "faq", label: "FAQ", group: "Content", description: "Questions that open to show the answer.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "items", label: "Questions", kind: "list", itemLabel: "Question", newItem: { q: "A new question?", a: "The answer." },
        item: [{ key: "q", label: "Question", kind: "text" }, { key: "a", label: "Answer", kind: "textarea" }] },
    ],
    defaults: { heading: "Questions", items: [{ q: "How do I get started?", a: "Send us a message and we'll reply within a day." }, { q: "Where are you based?", a: "We work from our studio downtown and online." }] },
  },
  {
    type: "cta", label: "Call to action", group: "Selling", description: "A bold banner that asks visitors to act.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "text", label: "Text", kind: "textarea" },
      { key: "primary", label: "Main button", kind: "link" },
      { key: "secondary", label: "Second button", kind: "link" },
    ],
    defaults: { heading: "Ready when you are", text: "Tell us what you need and we'll take it from there.", primary: link("Get in touch", "#contact"), secondary: link("", "") },
  },
  {
    type: "contact", label: "Contact", group: "Selling", description: "Your details and a message form.",
    fields: [
      { key: "heading", label: "Heading", kind: "text" },
      { key: "text", label: "Text", kind: "textarea" },
      { key: "email", label: "Email", kind: "text" },
      { key: "phone", label: "Phone", kind: "text" },
      { key: "address", label: "Address", kind: "textarea" },
      { key: "hours", label: "Hours", kind: "textarea" },
      { key: "form", label: "Show a message form", kind: "toggle" },
      { key: "button", label: "Form button text", kind: "text" },
    ],
    defaults: { heading: "Get in touch", text: "Send a message and we'll get back to you soon.", email: "hello@example.com", phone: "", address: "", hours: "", form: true, button: "Send message" },
  },
];

export const spec = (type: string) => SECTIONS.find((s) => s.type === type);
export const SECTION_GROUPS = [...new Set(SECTIONS.map((s) => s.group))];
