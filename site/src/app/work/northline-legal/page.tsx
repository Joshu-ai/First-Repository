import type { Metadata } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import { DemoBar } from "@/components/DemoBar";
import { ConsultForm } from "./ConsultForm";
import styles from "./northline.module.css";

const serif = Newsreader({ subsets: ["latin"], weight: ["500", "600"], variable: "--n-serif" });
const sans = Public_Sans({ subsets: ["latin"], variable: "--n-sans" });

export const metadata: Metadata = {
  title: "Northline Legal | Concept law firm site",
  description: "A concept website for a small law firm.",
};

const areas = [
  { title: "Business", body: "Company formation, contracts, partnership disputes and sale of a business." },
  { title: "Real estate", body: "Residential and commercial purchases, leases and title issues." },
  { title: "Employment", body: "Contracts, wrongful dismissal and workplace investigations, for staff and employers." },
  { title: "Wills and estates", body: "Wills, powers of attorney, trusts and probate, explained in plain terms." },
];

const team = [
  { name: "Maya Okafor", role: "Managing partner, business law", initials: "MO" },
  { name: "Daniel Reyes", role: "Partner, real estate", initials: "DR" },
  { name: "Priya Shah", role: "Associate, employment", initials: "PS" },
];

export default function NorthlineLegal() {
  return (
    <div className={`${styles.page} ${serif.variable} ${sans.variable}`}>
      <DemoBar name="Northline Legal" />
      <header className={styles.header}>
        <span className={styles.brand}>Northline Legal</span>
        <nav className={styles.nav} aria-label="Firm">
          <a href="#practice">Practice areas</a>
          <a href="#team">Our team</a>
          <a href="#consult" className={styles.navCta}>
            Free consultation
          </a>
        </nav>
      </header>

      <section className={styles.hero}>
        <h1>Clear legal advice for businesses and families in Minneapolis.</h1>
        <p>
          A firm of nine lawyers who answer the phone, quote fixed fees where we can, and explain
          your options before you commit to anything.
        </p>
        <a href="#consult" className={styles.heroCta}>
          Book a free 20-minute consultation
        </a>
      </section>

      <section id="practice" className={styles.section}>
        <h2>Practice areas</h2>
        <ul className={styles.areas}>
          {areas.map((a) => (
            <li key={a.title}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="team" className={`${styles.section} ${styles.teamSection}`}>
        <h2>Who you will work with</h2>
        <ul className={styles.team}>
          {team.map((t) => (
            <li key={t.name}>
              <span className={styles.avatar} aria-hidden="true">
                {t.initials}
              </span>
              <h3>{t.name}</h3>
              <p>{t.role}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="consult" className={`${styles.section} ${styles.consult}`}>
        <div>
          <h2>Talk to an attorney</h2>
          <p>
            Tell us briefly what is going on. The first conversation is free and confidential.
          </p>
        </div>
        <ConsultForm />
      </section>

      <footer className={styles.footer}>
        Northline Legal, 400 Hennepin Avenue, Minneapolis. This site does not give legal advice.
      </footer>
    </div>
  );
}
