import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { DemoBar } from "@/components/DemoBar";
import { Booking } from "./Booking";
import styles from "./fieldnote.module.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--f-sans" });

export const metadata: Metadata = {
  title: "Fieldnote | Concept booking app",
  description: "A concept appointment booking flow for a small clinic.",
};

export default function Fieldnote() {
  return (
    <div className={`${styles.page} ${sans.variable}`}>
      <DemoBar name="Fieldnote" />
      <header className={styles.header}>
        <span className={styles.brand}>
          <span className={styles.dot} aria-hidden="true" />
          Fieldnote
        </span>
        <span className={styles.clinic}>Eastside Family Clinic</span>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>Book an appointment</h1>
          <p>Choose what you need and a time that suits you. It takes about a minute.</p>
          <ul className={styles.facts}>
            <li>Free cancellation up to 24 hours before</li>
            <li>Reminders by text and email</li>
            <li>Same-week times for most services</li>
          </ul>
        </div>
        <Booking />
      </main>
    </div>
  );
}
