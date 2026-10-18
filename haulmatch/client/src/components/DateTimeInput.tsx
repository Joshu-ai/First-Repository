import { TextInput, type TextInputProps } from './Form';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string -> "YYYY-MM-DDTHH:mm" in local time, the value format of <input type="datetime-local">. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (local time) -> ISO string in UTC; null for empty/invalid input. */
export function localInputToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO for `hours` from `from` (default now), rounded up to the next quarter hour. Handy form defaults. */
export function isoHoursFromNow(hours: number, from: Date = new Date()): string {
  const t = new Date(from.getTime() + hours * 3_600_000);
  t.setSeconds(0, 0);
  const rem = t.getMinutes() % 15;
  if (rem) t.setMinutes(t.getMinutes() + (15 - rem));
  return t.toISOString();
}

export interface DateTimeInputProps
  extends Omit<TextInputProps, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'prefix' | 'suffix'> {
  /** ISO timestamp or null when empty. */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Earliest allowed moment (ISO). */
  min?: string | null;
  /** Latest allowed moment (ISO). */
  max?: string | null;
}

/** Native date+time picker in the viewer's local time that reads and writes ISO strings. */
export function DateTimeInput({ value, onChange, min, max, ...rest }: DateTimeInputProps) {
  return (
    <TextInput
      {...rest}
      type="datetime-local"
      value={isoToLocalInput(value)}
      min={min ? isoToLocalInput(min) : undefined}
      max={max ? isoToLocalInput(max) : undefined}
      onChange={(e) => onChange(localInputToIso(e.target.value))}
    />
  );
}
