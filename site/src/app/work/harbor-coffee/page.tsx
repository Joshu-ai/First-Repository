import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import { DemoBar } from "@/components/DemoBar";
import { Shop } from "./Shop";
import styles from "./harbor.module.css";

const display = Fraunces({ subsets: ["latin"], weight: ["700", "900"], variable: "--h-display" });
const body = Work_Sans({ subsets: ["latin"], variable: "--h-body" });

export const metadata: Metadata = {
  title: "Harbor Coffee | Concept store",
  description: "A concept online store for a small coffee roaster.",
};

export default function HarborCoffee() {
  return (
    <div className={`${styles.page} ${display.variable} ${body.variable}`}>
      <DemoBar name="Harbor Coffee" />
      <Shop />
      <section id="subscribe" className={styles.subscribe}>
        <h2>Never run out.</h2>
        <p>Pick a roast and how often. Skip or cancel any week from your account.</p>
        <a className={styles.secondary} href="#shop">
          Start a subscription
        </a>
      </section>
      <footer className={styles.footer}>Harbor Coffee, 12 Wharf Street, Portland, Maine</footer>
    </div>
  );
}
