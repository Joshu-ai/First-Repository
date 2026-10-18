// Form controls. Each takes `label`, optional `hint` and `error` and wires ids and
// aria-describedby/aria-invalid itself, so pages never hand-roll label plumbing.
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '../lib/cx';
import { Icon } from './Icon';

// ---------------------------------------------------------------------------
// Field: label + control + hint + error
// ---------------------------------------------------------------------------

export interface FieldProps {
  label: ReactNode;
  /** id of the control the label points at. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  /** Shows "Optional" next to the label. */
  optional?: boolean;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  className?: string;
  hintId?: string;
  errorId?: string;
  children: ReactNode;
}

/** Layout wrapper. Use it directly only for custom controls; the inputs below include it. */
export function Field({ label, htmlFor, hint, error, optional, hideLabel, className, hintId, errorId, children }: FieldProps) {
  return (
    <div className={cx('field', error && 'field--invalid', className)}>
      <label className={cx('field__label', hideLabel && 'visually-hidden')} htmlFor={htmlFor}>
        {label}
        {optional ? <span className="field__optional">Optional</span> : null}
      </label>
      {children}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

interface FieldIds {
  id: string;
  hintId: string;
  errorId: string;
  describedBy: string | undefined;
}

function useFieldIds(id: string | undefined, hint: ReactNode, error: string | null | undefined): FieldIds {
  const auto = useId();
  const base = id ?? auto;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return { id: base, hintId, errorId, describedBy };
}

interface CommonFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  hideLabel?: boolean;
  /** Class for the outer .field wrapper. */
  fieldClassName?: string;
}

// ---------------------------------------------------------------------------
// Text input
// ---------------------------------------------------------------------------

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>, CommonFieldProps {
  /** Text or icon shown inside the box before the value, e.g. "$". */
  prefix?: ReactNode;
  /** Text shown inside the box after the value, e.g. "lbs", "mi", "/mi". */
  suffix?: ReactNode;
  /** An interactive control inside the box on the right, e.g. a "Show" password button. */
  action?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, optional, hideLabel, fieldClassName, prefix, suffix, action, id, className, type = 'text', ...rest },
  ref,
) {
  const ids = useFieldIds(id, hint, error);
  // Units ("$", "lbs", "/mi") are read out as part of the description, not hidden.
  const prefixId = `${ids.id}-prefix`;
  const suffixId = `${ids.id}-suffix`;
  const describedBy =
    [prefix != null ? prefixId : '', suffix != null ? suffixId : '', ids.describedBy ?? ''].filter(Boolean).join(' ') ||
    undefined;
  return (
    <Field
      label={label}
      htmlFor={ids.id}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      className={fieldClassName}
      hintId={ids.hintId}
      errorId={ids.errorId}
    >
      <div
        className={cx(
          'input-wrap',
          prefix != null && 'input-wrap--prefix',
          suffix != null && 'input-wrap--suffix',
          action != null && 'input-wrap--action',
        )}
      >
        {prefix != null ? (
          <span className="input-wrap__prefix" id={prefixId}>
            {prefix}
          </span>
        ) : null}
        <input
          ref={ref}
          id={ids.id}
          type={type}
          className={cx('input', className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={rest.required || undefined}
          {...rest}
        />
        {suffix != null ? (
          <span className="input-wrap__suffix" id={suffixId}>
            {suffix}
          </span>
        ) : null}
        {action != null ? <span className="input-wrap__action">{action}</span> : null}
      </div>
    </Field>
  );
});

export type PasswordInputProps = Omit<TextInputProps, 'type' | 'action'>;

/** Password box with a Show/Hide toggle inside it. Pass autoComplete="current-password" or "new-password". */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(props, ref) {
  const [shown, setShown] = useState(false);
  return (
    <TextInput
      ref={ref}
      {...props}
      type={shown ? 'text' : 'password'}
      autoCapitalize="none"
      spellCheck={false}
      action={
        <button type="button" className="link-button" onClick={() => setShown((v) => !v)} aria-pressed={shown}>
          {shown ? 'Hide' : 'Show'}
          <span className="visually-hidden"> password</span>
        </button>
      }
    />
  );
});

// ---------------------------------------------------------------------------
// Number input
// ---------------------------------------------------------------------------

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix' | 'min' | 'max' | 'step'>,
    CommonFieldProps {
  value: number | null;
  /** Called with the parsed number, or null while the box is empty or not a number. */
  onChange: (value: number | null) => void;
  /** Allow decimals (shows the decimal keypad on phones). Default false: whole numbers. */
  decimal?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

/**
 * Numeric text box that keeps what the person typed ("2." while entering 2.5) and reports
 * numbers. Uses inputMode instead of type=number so mobile keypads are right and wheel
 * scrolling never changes values. Accepts "10,000". Range checks are left to the form/API
 * (show the range in `hint`).
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, decimal, onBlur, ...rest },
  ref,
) {
  const [text, setText] = useState(() => formatNumber(value, decimal));

  // Follow outside changes (form reset, prefill) without clobbering in-progress typing.
  useEffect(() => {
    setText((current) => (parseNumber(current, decimal) === value ? current : formatNumber(value, decimal)));
  }, [value, decimal]);

  return (
    <TextInput
      ref={ref}
      {...rest}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        if (!(decimal ? /^-?[\d,]*\.?\d*$/ : /^-?[\d,]*$/).test(next)) return;
        setText(next);
        onChange(parseNumber(next, decimal));
      }}
      onBlur={(e) => {
        // Tidy the text ("10000" -> "10,000") once the person moves on.
        const parsed = parseNumber(text, decimal);
        if (parsed !== null) setText(formatNumber(parsed, decimal));
        onBlur?.(e);
      }}
    />
  );
});

/** Whole numbers get thousands separators (10,000 lbs); decimals stay as typed (2.25). */
function formatNumber(value: number | null, decimal?: boolean): string {
  if (value == null) return '';
  return decimal ? String(value) : value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function parseNumber(text: string, decimal?: boolean): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return decimal ? n : Math.trunc(n);
}

// ---------------------------------------------------------------------------
// Text area
// ---------------------------------------------------------------------------

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, CommonFieldProps {
  /** Show a "120 / 500" counter when maxLength is set. Default true. */
  showCount?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, optional, hideLabel, fieldClassName, id, className, showCount = true, rows = 4, ...rest },
  ref,
) {
  const ids = useFieldIds(id, hint, error);
  const length = typeof rest.value === 'string' ? rest.value.length : null;
  return (
    <Field
      label={label}
      htmlFor={ids.id}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      className={fieldClassName}
      hintId={ids.hintId}
      errorId={ids.errorId}
    >
      <textarea
        ref={ref}
        id={ids.id}
        rows={rows}
        className={cx('input', 'textarea', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...rest}
      />
      {showCount && rest.maxLength && length !== null ? (
        <span className="field__count" aria-hidden="true">
          {length} / {rest.maxLength}
        </span>
      ) : null}
    </Field>
  );
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>,
    CommonFieldProps {
  value: T | '';
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** Adds a first, empty option ("Choose…"). */
  placeholder?: string;
}

export function Select<T extends string = string>({
  label,
  hint,
  error,
  optional,
  hideLabel,
  fieldClassName,
  id,
  className,
  value,
  onChange,
  options,
  placeholder,
  ...rest
}: SelectProps<T>) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Field
      label={label}
      htmlFor={ids.id}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      className={fieldClassName}
      hintId={ids.hintId}
      errorId={ids.errorId}
    >
      <div className="select-wrap">
        <select
          id={ids.id}
          className={cx('input', 'select', className)}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          {...rest}
        >
          {placeholder !== undefined ? (
            <option value="" disabled={rest.required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={18} className="select-wrap__chevron" />
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Checkbox and switch
// ---------------------------------------------------------------------------

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  label: ReactNode;
  /** Second line under the label. */
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
}

export function Checkbox({ label, description, checked, onChange, error, id, className, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id, description, error);
  return (
    <div className={cx('check', error && 'field--invalid', className)}>
      <input
        id={ids.id}
        type="checkbox"
        className="check__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      <label htmlFor={ids.id} className="check__label">
        <span className="check__box" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <span className="check__text">
          <span className="check__title">{label}</span>
          {description ? (
            <span className="check__description" id={ids.hintId}>
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p className="field__error" id={ids.errorId}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** On/off toggle (alerts on, available for loads). A native checkbox with role="switch". */
export function Switch({ label, description, checked, onChange, id, className, ...rest }: SwitchProps) {
  const ids = useFieldIds(id, description, null);
  return (
    <div className={cx('switch', className)}>
      <label htmlFor={ids.id} className="switch__text">
        <span className="switch__title">{label}</span>
        {description ? (
          <span className="switch__description" id={ids.hintId}>
            {description}
          </span>
        ) : null}
      </label>
      <input
        id={ids.id}
        type="checkbox"
        role="switch"
        className="switch__input"
        checked={checked}
        aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={ids.describedBy}
        {...rest}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radio cards
// ---------------------------------------------------------------------------

export interface RadioCardOption<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  /** Illustration or icon shown at the top/left of the card. */
  media?: ReactNode;
  disabled?: boolean;
}

export interface RadioCardsProps<T extends string> {
  /** The group's legend. */
  label: ReactNode;
  hideLabel?: boolean;
  /** Radio group name; generated when omitted. */
  name?: string;
  options: RadioCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  hint?: ReactNode;
  error?: string | null;
  /** Columns at tablet width and up (cards always stack on narrow phones). Default = number of options, max 3. */
  columns?: 1 | 2 | 3;
  /** Larger cards with media on top (signup role choice). */
  size?: 'md' | 'lg';
  className?: string;
}

/** Big, thumb-friendly single choice built on native radios inside a fieldset. */
export function RadioCards<T extends string>({
  label,
  hideLabel,
  name,
  options,
  value,
  onChange,
  hint,
  error,
  columns,
  size = 'md',
  className,
}: RadioCardsProps<T>) {
  const ids = useFieldIds(undefined, hint, error);
  const groupName = name ?? ids.id;
  const cols = columns ?? (Math.min(3, Math.max(1, options.length)) as 1 | 2 | 3);
  return (
    <fieldset
      className={cx('radio-cards', `radio-cards--cols-${cols}`, `radio-cards--${size}`, error && 'field--invalid', className)}
      aria-describedby={ids.describedBy}
    >
      <legend className={cx('field__label', hideLabel && 'visually-hidden')}>{label}</legend>
      {hint ? (
        <p className="field__hint" id={ids.hintId}>
          {hint}
        </p>
      ) : null}
      <div className="radio-cards__grid">
        {options.map((o) => {
          const optionId = `${ids.id}-${o.value}`;
          return (
            <div key={o.value} className="radio-card">
              <input
                id={optionId}
                type="radio"
                className="radio-card__input"
                name={groupName}
                value={o.value}
                checked={value === o.value}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
              />
              <label htmlFor={optionId} className="radio-card__label">
                {o.media ? <span className="radio-card__media">{o.media}</span> : null}
                <span className="radio-card__text">
                  <span className="radio-card__title">{o.title}</span>
                  {o.description ? <span className="radio-card__description">{o.description}</span> : null}
                </span>
                <span className="radio-card__mark" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </label>
            </div>
          );
        })}
      </div>
      {error ? (
        <p className="field__error" id={ids.errorId}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
