import { useId } from 'react';
import { STATE_CODES, US_STATES } from '../../../shared/geo';
import { cx } from '../lib/cx';
import { Icon } from './Icon';

export interface StateMultiSelectProps {
  label: string;
  /** USPS codes, e.g. ["TX", "OK"]. */
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
  error?: string | null;
  /** Codes that cannot be picked here (e.g. states already on the other list). */
  exclude?: string[];
  optional?: boolean;
  /** Text for the "add" dropdown. Default "Add a state…". */
  placeholder?: string;
  className?: string;
}

/**
 * Pick several US states: a native select to add (good on phones) and removable chips for the
 * current picks. Used for preferred/avoid states and destination-state filters.
 */
export function StateMultiSelect({
  label,
  value,
  onChange,
  hint,
  error,
  exclude = [],
  optional,
  placeholder = 'Add a state…',
  className,
}: StateMultiSelectProps) {
  const id = useId();
  const selectId = `${id}-select`;
  const available = STATE_CODES.filter((c) => !value.includes(c) && !exclude.includes(c));
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '', `${id}-chosen`].filter(Boolean).join(' ');

  return (
    <div className={cx('field', 'state-select', error && 'field--invalid', className)}>
      <label className="field__label" htmlFor={selectId}>
        {label}
        {optional ? <span className="field__optional">Optional</span> : null}
      </label>
      <div className="select-wrap">
        <select
          id={selectId}
          className="input select"
          value=""
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const code = e.target.value;
            if (code) onChange([...value, code].sort());
          }}
        >
          <option value="">{available.length ? placeholder : 'All states added'}</option>
          {available.map((code) => (
            <option key={code} value={code}>
              {US_STATES[code]} ({code})
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={18} className="select-wrap__chevron" />
      </div>
      <ul className="state-select__chips" id={`${id}-chosen`} aria-label={`${label}: selected`}>
        {value.length === 0 ? <li className="state-select__none muted">None selected</li> : null}
        {value.map((code) => (
          <li key={code}>
            <button
              type="button"
              className="chip chip--selected chip--removable"
              onClick={() => onChange(value.filter((c) => c !== code))}
              aria-label={`Remove ${US_STATES[code] ?? code}`}
            >
              <span>{code}</span>
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
        {value.length > 1 ? (
          <li>
            <button type="button" className="link-button" onClick={() => onChange([])}>
              Clear all
            </button>
          </li>
        ) : null}
      </ul>
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
