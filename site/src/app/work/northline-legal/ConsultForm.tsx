"use client";

import { useState } from "react";
import styles from "./northline.module.css";

export function ConsultForm() {
  const [name, setName] = useState<string | null>(null);

  if (name) {
    return (
      <div className={styles.form} role="status">
        <h3>Request sent</h3>
        <p>
          Thank you, {name}. An attorney will call you within one business day to arrange your free
          consultation.
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setName(String(data.get("name")).split(" ")[0]);
      }}
    >
      <label>
        Full name
        <input name="name" required autoComplete="name" />
      </label>
      <label>
        Phone or email
        <input name="contact" required autoComplete="email" />
      </label>
      <label>
        What do you need help with?
        <select name="area" defaultValue="Business">
          <option>Business</option>
          <option>Real estate</option>
          <option>Employment</option>
          <option>Wills and estates</option>
        </select>
      </label>
      <label>
        A few details (optional)
        <textarea name="details" rows={3} />
      </label>
      <button type="submit" className={styles.submit}>
        Request a consultation
      </button>
    </form>
  );
}
