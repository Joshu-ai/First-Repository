"use client";

import { useState } from "react";
import styles from "./harbor.module.css";

const coffees = [
  { id: "breakwater", name: "Breakwater", origin: "Colombia, Huila", notes: "Milk chocolate, red apple", price: 18, roast: "Medium" },
  { id: "low-tide", name: "Low Tide", origin: "Ethiopia, Guji", notes: "Jasmine, peach, black tea", price: 21, roast: "Light" },
  { id: "foghorn", name: "Foghorn", origin: "Brazil and Sumatra", notes: "Dark cocoa, molasses", price: 17, roast: "Dark" },
  { id: "mooring", name: "Mooring Decaf", origin: "Mexico, Chiapas", notes: "Toffee, almond", price: 19, roast: "Medium" },
];

export function Shop() {
  const [bag, setBag] = useState<Record<string, number>>({});
  const count = Object.values(bag).reduce((a, b) => a + b, 0);
  const total = coffees.reduce((sum, c) => sum + (bag[c.id] ?? 0) * c.price, 0);

  const add = (id: string) => setBag((b) => ({ ...b, [id]: (b[id] ?? 0) + 1 }));

  return (
    <>
      <header className={styles.header}>
        <span className={styles.brand}>Harbor Coffee</span>
        <nav className={styles.nav} aria-label="Shop">
          <a href="#shop">Shop</a>
          <a href="#subscribe">Subscribe</a>
        </nav>
        <span className={styles.bag} aria-live="polite">
          Bag ({count}){count > 0 && `, $${total}`}
        </span>
      </header>

      <section className={styles.hero}>
        <h1>Small-batch coffee, roasted by the water.</h1>
        <p>Roasted every Monday in Portland, Maine and shipped the same day.</p>
        <a className={styles.primary} href="#shop">
          Shop this week&apos;s roasts
        </a>
      </section>

      <section id="shop" className={styles.shop}>
        <h2>This week&apos;s roasts</h2>
        <ul className={styles.grid}>
          {coffees.map((c) => (
            <li key={c.id} className={styles.product}>
              <div className={styles.bagArt} data-roast={c.roast} aria-hidden="true">
                <span>{c.name}</span>
              </div>
              <div className={styles.productInfo}>
                <h3>{c.name}</h3>
                <span>${c.price}</span>
              </div>
              <p>{c.origin}</p>
              <p className={styles.notes}>{c.notes}</p>
              <button type="button" onClick={() => add(c.id)} className={styles.add}>
                {bag[c.id] ? `Add another (${bag[c.id]} in bag)` : "Add to bag"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
