import { spec } from "./sections";
import { uid, type Data, type Page, type SiteDoc, type Tone } from "./types";

// Starter templates. Each one is an ordinary SiteDoc, so everything in it can be edited.

export type Template = { id: string; name: string; category: string; blurb: string; doc: () => SiteDoc };

const sec = (type: string, tone: Tone, data: Data = {}) => ({ id: uid(), type, tone, data: { ...structuredClone(spec(type)!.defaults), ...data } });
const page = (title: string, slug: string, sections: Page["sections"]): Page => ({ id: uid(), title, slug, sections });
const L = (label: string, href: string) => ({ label, href });
const foot = (f: Partial<SiteDoc["footer"]>): SiteDoc["footer"] => ({ text: "", email: "", phone: "", address: "", instagram: "", facebook: "", linkedin: "", ...f });

export const TEMPLATES: Template[] = [
  {
    id: "ember", name: "Ember", category: "Restaurant & café", blurb: "Warm and inviting, with a full menu and visit page.",
    doc: () => ({
      v: 1, name: "Ember Kitchen", theme: { palette: "paper", font: "classic", shape: "soft" },
      nav: { cta: L("Book a table", "/visit") },
      footer: foot({ text: "Wood-fired cooking with local produce.", email: "hello@emberkitchen.com", phone: "(503) 555-0142", address: "418 Alder St, Portland", instagram: "https://instagram.com" }),
      pages: [
        page("Home", "", [
          sec("hero", "light", { layout: "split", eyebrow: "Open Tue to Sun", heading: "Wood-fired food, made for sharing", text: "Seasonal plates from our open hearth, natural wines, and a table that always has room for one more.", primary: L("Book a table", "/visit"), secondary: L("See the menu", "/menu"), image: "ph:1" }),
          sec("imageText", "muted", { eyebrow: "Our kitchen", heading: "Cooked over fire, every day", text: "We buy from farms within a hundred miles and let the season set the menu. Everything is cooked over oak in the hearth at the center of the room.\n\nCome for a quick bite at the bar or settle in for the evening.", image: "ph:2", side: "left", button: L("Read our story", "/visit") }),
          sec("menu", "light", { heading: "A taste of the menu", intro: "", items: [
            { category: "To start", name: "Charred flatbread", description: "Whipped feta, chili honey, herbs.", price: "$12" },
            { category: "To start", name: "Ember-roasted beets", description: "Smoked yogurt, hazelnut dukkah.", price: "$14" },
            { category: "From the hearth", name: "Half chicken", description: "Salsa verde, crisp potatoes.", price: "$28" },
            { category: "From the hearth", name: "Flat iron steak", description: "Bone marrow butter, watercress.", price: "$36" },
          ] }),
          sec("testimonials", "dark", { heading: "What our guests say", items: [
            { quote: "The best meal we've had in the city this year. The flatbread alone is worth the trip.", name: "Dana P.", role: "Local guide" },
            { quote: "Cozy, friendly and every plate was a hit. We're already planning our next visit.", name: "Marcus T.", role: "Regular" },
            { quote: "They made our anniversary dinner feel genuinely special.", name: "Lena & Rob", role: "Guests" },
          ] }),
          sec("cta", "accent", { heading: "Your table is waiting", text: "Walk-ins welcome at the bar. Book ahead for groups of six or more.", primary: L("Book a table", "/visit"), secondary: L("", "") }),
        ]),
        page("Menu", "menu", [
          sec("text", "muted", { heading: "Menu", text: "Our menu changes with the season. Ask your server about today's specials.", align: "center" }),
          sec("menu", "light", { heading: "", items: [
            { category: "To start", name: "Charred flatbread", description: "Whipped feta, chili honey, herbs.", price: "$12" },
            { category: "To start", name: "Ember-roasted beets", description: "Smoked yogurt, hazelnut dukkah.", price: "$14" },
            { category: "To start", name: "Grilled oysters", description: "Garlic butter, lemon. Half dozen.", price: "$19" },
            { category: "From the hearth", name: "Half chicken", description: "Salsa verde, crisp potatoes.", price: "$28" },
            { category: "From the hearth", name: "Flat iron steak", description: "Bone marrow butter, watercress.", price: "$36" },
            { category: "From the hearth", name: "Whole grilled fish", description: "Fennel, citrus, olive oil.", price: "$34" },
            { category: "Sweet", name: "Burnt honey custard", description: "Shortbread crumb.", price: "$10" },
            { category: "Sweet", name: "Fire-roasted peach", description: "Vanilla ice cream, almond.", price: "$11" },
          ] }),
        ]),
        page("Visit", "visit", [
          sec("contact", "light", { heading: "Visit us", text: "Book a table or ask us anything. We reply within a day.", email: "hello@emberkitchen.com", phone: "(503) 555-0142", address: "418 Alder St\nPortland, OR 97205", hours: "Tue to Thu: 5pm to 10pm\nFri and Sat: 5pm to 11pm\nSun: 11am to 3pm", form: true, button: "Request a booking" }),
          sec("faq", "muted", { heading: "Good to know", items: [
            { q: "Do you take walk-ins?", a: "Yes. The bar and patio are kept for walk-ins every night." },
            { q: "Can you cater for allergies?", a: "Absolutely. Let us know when you book and we'll plan around it." },
            { q: "Do you host private events?", a: "Our back room seats 24. Send us a message with your date." },
          ] }),
        ]),
      ],
    }),
  },
  {
    id: "lens", name: "Lens", category: "Portfolio & photography", blurb: "Dark, image-first portfolio that lets the work lead.",
    doc: () => ({
      v: 1, name: "Mara Quinn", theme: { palette: "midnight", font: "geometric", shape: "square" },
      nav: { cta: L("Book a shoot", "/contact") },
      footer: foot({ text: "Photographer. Portraits, editorial and weddings.", email: "studio@maraquinn.com", instagram: "https://instagram.com" }),
      pages: [
        page("Work", "", [
          sec("hero", "dark", { layout: "cover", eyebrow: "Photographer based in Denver", heading: "Honest pictures of people and places", text: "Portraits, editorial and weddings, shot on location across the West.", primary: L("View portfolio", "#gallery"), secondary: L("Get in touch", "/contact"), image: "ph:6" }),
          sec("gallery", "light", { heading: "Selected work", intro: "", columns: "3", items: [1, 2, 3, 4, 5, 6].map((n, i) => ({ image: `ph:${n}`, caption: ["High desert, 2026", "Elena, portrait", "Wedding at Ward Lake", "Market morning", "Editorial for Field Notes", "Late light"][i] })) }),
          sec("logos", "muted", { heading: "Published in", items: ["Field Notes", "Open Road", "Atlas Weekly", "Kinfolk Table", "Summit"].map((name) => ({ name })) }),
          sec("testimonials", "light", { heading: "Clients", items: [
            { quote: "Mara has a way of making you forget the camera is there. Our photos feel like us.", name: "Jess & Andre", role: "Wedding clients" },
            { quote: "Quick, calm and endlessly creative on a tough shoot. We book her every season.", name: "Tomás Reyes", role: "Photo editor, Open Road" },
          ] }),
          sec("cta", "dark", { heading: "Let's make something", text: "Now booking spring and summer dates.", primary: L("Check availability", "/contact"), secondary: L("", "") }),
        ]),
        page("About", "about", [
          sec("imageText", "light", { eyebrow: "About", heading: "Hi, I'm Mara", text: "I've been photographing people for twelve years, first for newspapers and now for brands, magazines and couples.\n\nI work with natural light and small crews, and I care most about pictures that feel true.", image: "ph:4", side: "left", button: L("Work with me", "/contact") }),
          sec("stats", "muted", { heading: "", items: [{ value: "12", label: "Years shooting" }, { value: "140+", label: "Weddings" }, { value: "30", label: "Magazine features" }] }),
        ]),
        page("Contact", "contact", [
          sec("contact", "light", { heading: "Book a shoot", text: "Tell me about your project, your date and your location. I reply within two days.", email: "studio@maraquinn.com", phone: "", address: "Denver, Colorado", hours: "", form: true, button: "Send enquiry" }),
        ]),
      ],
    }),
  },
  {
    id: "counsel", name: "Counsel", category: "Consulting & services", blurb: "Polished and trustworthy, for consultants, agencies and firms.",
    doc: () => ({
      v: 1, name: "Brightwater Advisory", theme: { palette: "harbor", font: "editorial", shape: "soft" },
      nav: { cta: L("Book a call", "/contact") },
      footer: foot({ text: "Finance and operations advice for growing companies.", email: "hello@brightwater.co", phone: "(415) 555-0199", linkedin: "https://linkedin.com" }),
      pages: [
        page("Home", "", [
          sec("hero", "light", { layout: "split", eyebrow: "Advisory for founders", heading: "Clear numbers. Confident decisions.", text: "We help growing companies plan, raise and scale with a part-time finance team that feels like your own.", primary: L("Book a free call", "/contact"), secondary: L("Our services", "/services"), image: "ph:3" }),
          sec("logos", "muted", { heading: "Trusted by teams at", items: ["Northwind", "Lumen Health", "Atlas & Co", "Brightside", "Kestrel Labs"].map((name) => ({ name })) }),
          sec("features", "light", { heading: "How we help", intro: "Senior expertise, without the full-time cost.", columns: "3", items: [
            { icon: "bolt", title: "Fundraising", text: "Models, decks and data rooms investors trust." },
            { icon: "shield", title: "Financial controls", text: "Clean books, monthly closes and audit-ready reporting." },
            { icon: "chat", title: "Board reporting", text: "Clear monthly updates your board will actually read." },
          ] }),
          sec("stats", "dark", { heading: "", items: [{ value: "$310M", label: "Raised by clients" }, { value: "85", label: "Companies advised" }, { value: "15 yrs", label: "Average experience" }] }),
          sec("testimonials", "light", { heading: "Client stories", items: [
            { quote: "Brightwater got us ready for our Series A in six weeks. Investors commented on how clean our numbers were.", name: "Ana Liu", role: "CEO, Lumen Health" },
            { quote: "Like having a CFO on call. Practical, fast and honest.", name: "Ben Okafor", role: "Founder, Kestrel Labs" },
          ] }),
          sec("cta", "accent", { heading: "Let's talk about your next stage", text: "A free 30-minute call. No pitch, just advice.", primary: L("Book a call", "/contact"), secondary: L("", "") }),
        ]),
        page("Services", "services", [
          sec("pricing", "light", { heading: "Ways to work together", intro: "Simple monthly retainers. Cancel any time.", items: [
            { name: "Essentials", price: "$2,500", period: "/mo", description: "Bookkeeping oversight and monthly reporting.", features: "Monthly close\nCash flow forecast\nQuarterly review", button: L("Get started", "/contact"), featured: false },
            { name: "Growth", price: "$6,000", period: "/mo", description: "A fractional CFO for scaling teams.", features: "Everything in Essentials\nBudget and plan\nBoard pack\nInvestor updates", button: L("Get started", "/contact"), featured: true },
            { name: "Raise", price: "Custom", period: "", description: "Hands-on support through a round.", features: "Financial model\nDeck review\nData room\nInvestor Q&A prep", button: L("Talk to us", "/contact"), featured: false },
          ] }),
          sec("faq", "muted", { heading: "Questions", items: [
            { q: "Do you replace our accountant?", a: "No. We work alongside your bookkeeper and accountant and make sure the numbers tell a clear story." },
            { q: "How quickly can you start?", a: "Most clients are up and running within two weeks." },
          ] }),
        ]),
        page("Contact", "contact", [
          sec("contact", "light", { heading: "Book a call", text: "Tell us a little about your company and we'll find a time.", email: "hello@brightwater.co", phone: "(415) 555-0199", address: "88 Market St, San Francisco", hours: "Mon to Fri, 9am to 6pm PT", form: true, button: "Request a call" }),
        ]),
      ],
    }),
  },
  {
    id: "pulse", name: "Pulse", category: "Fitness & wellness", blurb: "Bold and energetic, with memberships, coaches and FAQs.",
    doc: () => ({
      v: 1, name: "PULSE Studio", theme: { palette: "citrus", font: "friendly", shape: "round" },
      nav: { cta: L("Free first class", "#pricing") },
      footer: foot({ text: "Strength and conditioning for every body.", email: "team@pulsestudio.fit", phone: "(512) 555-0110", address: "200 E 6th St, Austin", instagram: "https://instagram.com" }),
      pages: [
        page("Home", "", [
          sec("hero", "dark", { layout: "split", eyebrow: "Small-group training", heading: "Get stronger. Have fun doing it.", text: "45-minute coached classes for every fitness level. Your first class is on us.", primary: L("Claim a free class", "#pricing"), secondary: L("See the schedule", "#faq"), image: "ph:5" }),
          sec("features", "light", { heading: "Why members stay", intro: "", columns: "4", items: [
            { icon: "bolt", title: "Coached", text: "Every class is led by a certified coach." },
            { icon: "heart", title: "Welcoming", text: "No egos. Every level is welcome." },
            { icon: "clock", title: "45 minutes", text: "In, out and on with your day." },
            { icon: "sparkle", title: "Results", text: "Progress you can track every month." },
          ] }),
          sec("pricing", "muted", { heading: "Memberships", intro: "No sign-up fees. Pause or cancel any time.", items: [
            { name: "Drop-in", price: "$25", period: "/class", description: "Come when you like.", features: "Any class\nNo commitment", button: L("Book a class", "#contact"), featured: false },
            { name: "Unlimited", price: "$149", period: "/mo", description: "Our most popular plan.", features: "Unlimited classes\nMonthly check-in\nMember events", button: L("Start free", "#contact"), featured: true },
            { name: "8 classes", price: "$109", period: "/mo", description: "Twice a week.", features: "8 classes a month\nRollover up to 4", button: L("Start free", "#contact"), featured: false },
          ] }),
          sec("team", "light", { heading: "Your coaches", intro: "", items: [{ image: "ph:4", name: "Riley Banks", role: "Head coach" }, { image: "ph:5", name: "Theo Martins", role: "Strength coach" }, { image: "ph:6", name: "Ines Park", role: "Mobility coach" }, { image: "ph:3", name: "Sol Avery", role: "Coach" }] }),
          sec("faq", "muted", { heading: "FAQ", items: [
            { q: "I'm a beginner. Is that okay?", a: "Yes. Every movement has options, and your coach will help you pick the right one." },
            { q: "What should I bring?", a: "Comfortable clothes, trainers and a water bottle. We have towels." },
            { q: "When are classes?", a: "Weekdays at 6am, 7am, 12pm, 5:30pm and 6:30pm. Weekends at 8am and 9am." },
          ] }),
          sec("contact", "dark", { heading: "Claim your free class", text: "Leave your details and we'll get you booked in.", email: "team@pulsestudio.fit", phone: "(512) 555-0110", address: "200 E 6th St, Austin", hours: "", form: true, button: "Book my free class" }),
        ]),
      ],
    }),
  },
  {
    id: "bloom", name: "Bloom", category: "Events & weddings", blurb: "Soft and romantic, for florists, planners and venues.",
    doc: () => ({
      v: 1, name: "Bloom & Vine", theme: { palette: "blush", font: "elegant", shape: "soft" },
      nav: { cta: L("Enquire", "#contact") },
      footer: foot({ text: "Floral design for weddings and events.", email: "hello@bloomandvine.studio", instagram: "https://instagram.com" }),
      pages: [
        page("Home", "", [
          sec("hero", "light", { layout: "centered", eyebrow: "Floral studio", heading: "Flowers for the days you'll remember", text: "Seasonal, garden-style floral design for weddings, celebrations and intimate gatherings.", primary: L("Check your date", "#contact"), secondary: L("See our work", "#gallery"), image: "ph:2" }),
          sec("imageText", "muted", { eyebrow: "Our approach", heading: "Grown nearby, arranged by hand", text: "We work with small local growers and design around what is at its best that week. Every piece is loose, natural and a little wild.", image: "ph:3", side: "right", button: L("", "") }),
          sec("gallery", "light", { heading: "Recent celebrations", intro: "", columns: "3", items: [1, 2, 3, 4, 5, 6].map((n) => ({ image: `ph:${n}`, caption: "" })) }),
          sec("testimonials", "muted", { heading: "Love notes", items: [
            { quote: "Our guests are still talking about the flowers. They were beyond anything we imagined.", name: "Hannah & Joe", role: "June wedding" },
            { quote: "Calm, kind and so talented. The whole day felt effortless.", name: "Priya", role: "Bride" },
          ] }),
          sec("contact", "light", { heading: "Let's talk flowers", text: "Share your date, venue and a few words about your day.", email: "hello@bloomandvine.studio", phone: "", address: "Hudson Valley, New York", hours: "", form: true, button: "Send enquiry" }),
        ]),
      ],
    }),
  },
  {
    id: "launch", name: "Launch", category: "Product & startup", blurb: "Crisp one-page landing for an app or product launch.",
    doc: () => ({
      v: 1, name: "Tidy", theme: { palette: "mono", font: "modern", shape: "soft" },
      nav: { cta: L("Start free", "#pricing") },
      footer: foot({ text: "The calm way to run your inbox.", email: "support@tidy.app", linkedin: "https://linkedin.com" }),
      pages: [
        page("Home", "", [
          sec("hero", "light", { layout: "centered", eyebrow: "New: Tidy 2.0", heading: "Inbox zero, without the effort", text: "Tidy sorts, summarizes and schedules your email so you can spend your day on real work.", primary: L("Start free", "#pricing"), secondary: L("See how it works", "#features"), image: "ph:6" }),
          sec("logos", "light", { heading: "Used by teams at", items: ["Northwind", "Lumen", "Atlas", "Brightside", "Kestrel", "Orbit"].map((name) => ({ name })) }),
          sec("features", "muted", { heading: "Everything in its place", intro: "Three tools that save the average user five hours a week.", columns: "3", items: [
            { icon: "sparkle", title: "Smart sorting", text: "Newsletters, receipts and real mail, each in its own lane." },
            { icon: "chat", title: "Summaries", text: "Long threads condensed into three lines." },
            { icon: "clock", title: "Send later", text: "Write now, deliver at the right time." },
          ] }),
          sec("imageText", "light", { eyebrow: "Built for focus", heading: "Check email twice a day, not two hundred times", text: "Tidy bundles what can wait and only interrupts you for what can't.", image: "ph:1", side: "right", button: L("Start free", "#pricing") }),
          sec("pricing", "muted", { heading: "Pricing", intro: "Free for personal use.", items: [
            { name: "Free", price: "$0", period: "", description: "For one inbox.", features: "Smart sorting\n7-day history", button: L("Get started", "#contact"), featured: false },
            { name: "Pro", price: "$8", period: "/mo", description: "For people who live in email.", features: "Unlimited inboxes\nSummaries\nSend later", button: L("Start free trial", "#contact"), featured: true },
            { name: "Team", price: "$12", period: "/user/mo", description: "Shared inboxes for teams.", features: "Everything in Pro\nShared labels\nAdmin controls", button: L("Contact sales", "#contact"), featured: false },
          ] }),
          sec("faq", "light", { heading: "FAQ", items: [
            { q: "Does Tidy read my email?", a: "Sorting happens on your device. Nothing is stored on our servers." },
            { q: "Which providers do you support?", a: "Gmail, Outlook and any IMAP account." },
          ] }),
          sec("cta", "dark", { heading: "Try Tidy free for 14 days", text: "No credit card required.", primary: L("Start free", "#pricing"), secondary: L("", "") }),
          sec("contact", "light", { heading: "Talk to us", text: "Questions about teams or security? We're happy to help.", email: "support@tidy.app", phone: "", address: "", hours: "", form: true, button: "Send" }),
        ]),
      ],
    }),
  },
  {
    id: "blank", name: "Blank", category: "Start from scratch", blurb: "A single page with a hero. Add sections as you go.",
    doc: () => ({
      v: 1, name: "My Site", theme: { palette: "sage", font: "modern", shape: "soft" },
      nav: { cta: L("Contact", "#contact") },
      footer: foot({ text: "", email: "" }),
      pages: [page("Home", "", [sec("hero", "light", { layout: "centered", image: "" })])],
    }),
  },
];

export const template = (id: string) => TEMPLATES.find((t) => t.id === id);
