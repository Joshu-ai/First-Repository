"use client";

import { useState } from "react";
import styles from "./fieldnote.module.css";

const services = [
  { id: "checkup", name: "Annual check-up", length: "30 min" },
  { id: "physio", name: "Physiotherapy session", length: "45 min" },
  { id: "bloods", name: "Blood test", length: "15 min" },
];

const days = ["Mon 9", "Tue 10", "Wed 11", "Thu 12", "Fri 13"];

// Fixed sample availability so the demo renders the same everywhere.
const slots: Record<string, string[]> = {
  "Mon 9": ["9:00", "9:30", "11:00", "14:30", "16:00"],
  "Tue 10": ["8:30", "10:00", "13:00"],
  "Wed 11": ["9:00", "12:30", "15:00", "15:30", "17:00"],
  "Thu 12": [],
  "Fri 13": ["8:00", "8:30", "10:30", "11:00"],
};

export function Booking() {
  const [service, setService] = useState(services[0].id);
  const [day, setDay] = useState(days[0]);
  const [time, setTime] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  const chosen = services.find((s) => s.id === service)!;

  if (booked) {
    return (
      <div className={styles.card} role="status">
        <h2>Appointment booked</h2>
        <p className={styles.confirm}>
          {chosen.name} on {day} at {time}. A confirmation and calendar invite are on their way to
          your email.
        </p>
        <button
          type="button"
          className={styles.ghost}
          onClick={() => {
            setBooked(false);
            setTime(null);
          }}
        >
          Book another appointment
        </button>
      </div>
    );
  }

  return (
    <form
      className={styles.card}
      onSubmit={(e) => {
        e.preventDefault();
        if (time) setBooked(true);
      }}
    >
      <fieldset className={styles.group}>
        <legend>1. Choose a service</legend>
        <div className={styles.services}>
          {services.map((s) => (
            <label key={s.id} className={styles.option}>
              <input
                type="radio"
                name="service"
                value={s.id}
                checked={service === s.id}
                onChange={() => setService(s.id)}
              />
              <span>{s.name}</span>
              <small>{s.length}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>2. Pick a day</legend>
        <div className={styles.days}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={day === d}
              className={styles.chip}
              onClick={() => {
                setDay(d);
                setTime(null);
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>3. Pick a time</legend>
        {slots[day].length === 0 ? (
          <p className={styles.empty}>No times left on {day}. Try another day.</p>
        ) : (
          <div className={styles.times}>
            {slots[day].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={time === t}
                className={styles.chip}
                onClick={() => setTime(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <div className={styles.summary}>
        <p>
          {time ? `${chosen.name}, ${day} at ${time}` : "Choose a time to continue."}
        </p>
        <button type="submit" className={styles.primary} disabled={!time}>
          Book appointment
        </button>
      </div>
    </form>
  );
}
