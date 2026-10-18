import { useId } from 'react';
import { EQUIPMENT, HOTSHOT_EQUIPMENT, SEMI_EQUIPMENT } from '../../../shared/equipment';
import type { DriverClass, EquipmentCode } from '../../../shared/types';
import { cx } from '../lib/cx';
import { Icon } from './Icon';

export interface EquipmentChipsProps {
  codes: EquipmentCode[];
  /** Codes that match the viewer's rig; shown first with a check and brand tint. */
  matched?: EquipmentCode[];
  /** Show at most this many chips, then "+N more". */
  max?: number;
  /** Use full labels ("Hotshot gooseneck flatbed") instead of short ones ("Gooseneck"). */
  long?: boolean;
  /** Screen-reader note on matched chips. Shippers looking at a driver pass "fits this load". */
  matchedLabel?: string;
  className?: string;
}

/** Read-only equipment tags for a load or a rig. */
export function EquipmentChips({ codes, matched = [], max, long, matchedLabel = 'fits your rig', className }: EquipmentChipsProps) {
  const ordered = [...codes].sort((a, b) => Number(matched.includes(b)) - Number(matched.includes(a)));
  const shown = max && ordered.length > max ? ordered.slice(0, max) : ordered;
  const hidden = ordered.length - shown.length;
  return (
    <ul className={cx('equipment-chips', className)} aria-label="Equipment">
      {shown.map((code) => {
        const isMatch = matched.includes(code);
        const info = EQUIPMENT[code];
        return (
          <li key={code} className={cx('tag', isMatch ? 'tag--brand' : 'tag--neutral')} title={info?.label}>
            {isMatch ? <Icon name="check" size={14} /> : null}
            {info ? (long ? info.label : info.shortLabel) : code}
            {isMatch ? <span className="visually-hidden"> ({matchedLabel})</span> : null}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li className="tag tag--neutral" title={ordered.slice(shown.length).map((c) => EQUIPMENT[c]?.shortLabel).join(', ')}>
          +{hidden} more
        </li>
      ) : null}
    </ul>
  );
}

export interface EquipmentPickerProps {
  label?: string;
  value: EquipmentCode[];
  onChange: (value: EquipmentCode[]) => void;
  /** Which groups to offer. Drivers pass their class; shippers leave the default (both). */
  classes?: DriverClass[];
  hint?: string;
  error?: string | null;
  /** Hide the per-option description (compact filter panels). */
  compact?: boolean;
  className?: string;
}

const GROUPS: { driverClass: DriverClass; title: string; codes: EquipmentCode[] }[] = [
  { driverClass: 'hotshot', title: 'Hotshot', codes: HOTSHOT_EQUIPMENT },
  { driverClass: 'semi', title: 'Semi', codes: SEMI_EQUIPMENT },
];

/** Multi-select of equipment types grouped Hotshot / Semi, each with a description. */
export function EquipmentPicker({
  label = 'Equipment',
  value,
  onChange,
  classes = ['hotshot', 'semi'],
  hint,
  error,
  compact,
  className,
}: EquipmentPickerProps) {
  const id = useId();
  const groups = GROUPS.filter((g) => classes.includes(g.driverClass));
  const toggle = (code: EquipmentCode, on: boolean) =>
    onChange(on ? [...value.filter((c) => c !== code), code] : value.filter((c) => c !== code));

  return (
    <fieldset
      className={cx('equipment-picker', compact && 'equipment-picker--compact', error && 'field--invalid', className)}
      aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].join(' ').trim() || undefined}
    >
      <legend className="field__label">{label}</legend>
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {groups.map((group) => (
        <div
          key={group.driverClass}
          className="equipment-picker__group"
          role="group"
          aria-labelledby={`${id}-${group.driverClass}`}
        >
          {groups.length > 1 ? (
            <div className="equipment-picker__group-head">
              <h3 className="equipment-picker__group-title" id={`${id}-${group.driverClass}`}>
                {group.title}
              </h3>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  const all = group.codes.every((c) => value.includes(c));
                  onChange(all ? value.filter((c) => !group.codes.includes(c)) : [...new Set([...value, ...group.codes])]);
                }}
              >
                {group.codes.every((c) => value.includes(c)) ? 'Clear' : 'Select all'}
              </button>
            </div>
          ) : (
            <span className="visually-hidden" id={`${id}-${group.driverClass}`}>
              {group.title}
            </span>
          )}
          <div className="equipment-picker__options">
            {group.codes.map((code) => {
              const info = EQUIPMENT[code];
              const optionId = `${id}-${code}`;
              const checked = value.includes(code);
              return (
                <div key={code} className="option-card">
                  <input
                    id={optionId}
                    type="checkbox"
                    className="option-card__input"
                    checked={checked}
                    onChange={(e) => toggle(code, e.target.checked)}
                  />
                  <label htmlFor={optionId} className="option-card__label">
                    <span className="option-card__box" aria-hidden="true">
                      <Icon name="check" size={16} />
                    </span>
                    <span className="option-card__text">
                      <span className="option-card__title">{compact ? info.shortLabel : info.label}</span>
                      {compact ? null : <span className="option-card__description">{info.description}</span>}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
