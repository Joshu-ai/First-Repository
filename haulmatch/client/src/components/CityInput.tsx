import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { City, Place } from '../../../shared/types';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { place as formatPlace } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Field } from './Form';
import { Icon } from './Icon';
import { Spinner } from './Feedback';

/** Convert a stored Place (profile/load) into the City value CityInput works with. */
export function placeToCity(p: Place): City {
  return { id: p.cityId, name: p.city, state: p.state, lat: p.lat, lng: p.lng };
}

/** Same, null-safe: placeToCityOrNull(profile.currentLocation). */
export function placeToCityOrNull(p: Place | null | undefined): City | null {
  return p ? placeToCity(p) : null;
}

export interface CityInputProps {
  label: string;
  value: City | null;
  onChange: (city: City | null) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  hideLabel?: boolean;
  id?: string;
  /** Results per query (API max 25). Default 8. */
  limit?: number;
  className?: string;
}

const cityLabel = (c: City) => formatPlace(c);

/** Shorter text does not search. */
const MIN_QUERY = 2;

/**
 * What Enter does in the box. `resultsFor` is the search text the suggestion list belongs to, so a
 * list left over from a shorter prefix ("San" while the box says "San Diego") is never picked:
 * - pass: the box shows the picked city (or is empty), so Enter goes on to submit the form;
 * - choose: take the highlighted suggestion, which belongs to the text in the box;
 * - wait: the suggestions for this text are still coming; take the top one when they arrive;
 * - ignore: half-typed text with nothing to pick; swallow Enter so the form does not submit.
 */
export type CityEnterAction = 'pass' | 'choose' | 'wait' | 'ignore';

export function cityEnterAction(state: {
  dirty: boolean;
  text: string;
  resultsFor: string | null;
  /** A suggestion is highlighted in the open list. */
  hasActive: boolean;
}): CityEnterAction {
  const q = state.text.trim();
  if (!state.dirty || q === '') return 'pass';
  if (q.length < MIN_QUERY) return 'ignore';
  if (state.resultsFor === q) return state.hasActive ? 'choose' : 'ignore';
  return 'wait';
}

/**
 * City autocomplete over GET /api/cities (ARIA 1.2 combobox with a listbox popup).
 * Typing clears the selection until a suggestion is picked; leaving the box restores the
 * last picked city so the value is always a real City or null.
 */
export function CityInput({
  label,
  value,
  onChange,
  placeholder = 'City, e.g. Odessa, TX',
  hint,
  error,
  required,
  optional,
  disabled,
  autoFocus,
  hideLabel,
  id,
  limit = 8,
  className,
}: CityInputProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;
  const statusId = `${autoId}-status`;

  const [text, setText] = useState(value ? cityLabel(value) : '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<City[]>([]);
  /** The trimmed text `results` were found for (null when there are none). */
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** True while the box holds typed text that is not the selected city. */
  const [dirty, setDirty] = useState(false);
  const query = useDebounced(text, 200);
  const valueId = value?.id ?? null;
  const valueRef = useRef(value);
  valueRef.current = value;
  /** Enter was pressed before the suggestions for this text arrived: pick the top one when they do. */
  const pendingPick = useRef<string | null>(null);

  // Keep the box in sync when the parent picks a different city or clears it. Keyed on the id
  // so callers can pass a fresh object every render (placeToCity(profile.currentLocation)).
  useEffect(() => {
    setDirty(false);
    setText(valueRef.current ? cityLabel(valueRef.current) : '');
  }, [valueId]);

  useEffect(() => {
    const q = query.trim();
    if (!dirty || q.length < MIN_QUERY) {
      setResults([]);
      setResultsFor(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    api.meta
      .searchCities(q, limit, { signal: controller.signal })
      .then((cities) => {
        if (controller.signal.aborted) return;
        if (pendingPick.current === q) {
          pendingPick.current = null;
          if (cities.length) {
            chooseRef.current(cities[0]);
            return;
          }
        }
        setResults(cities);
        setResultsFor(q);
        setActive(cities.length ? 0 : -1);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          if (pendingPick.current === q) pendingPick.current = null;
          setResults([]);
          setResultsFor(null);
          setFailed(!(err instanceof DOMException));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, limit, dirty]);

  const choose = (city: City) => {
    pendingPick.current = null;
    setDirty(false);
    setText(cityLabel(city));
    setOpen(false);
    setResults([]);
    setResultsFor(null);
    onChange(city);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  const restore = () => {
    pendingPick.current = null;
    setOpen(false);
    if (text.trim() === '') {
      if (value) onChange(null);
      return;
    }
    setDirty(false);
    setText(value ? cityLabel(value) : '');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (results.length ? (i + 1) % results.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i <= 0 ? results.length - 1 : i - 1) : -1));
    } else if (e.key === 'Enter') {
      const action = cityEnterAction({ dirty, text, resultsFor, hasActive: open && active >= 0 && Boolean(results[active]) });
      if (action === 'pass') return;
      e.preventDefault();
      if (action === 'choose') choose(results[active]);
      else if (action === 'wait') {
        pendingPick.current = text.trim();
        setOpen(true);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        restore();
      }
    }
  };

  const showList = open && dirty && text.trim().length >= MIN_QUERY;
  const describedBy = [hint ? hintId : '', error ? errorId : '', statusId].filter(Boolean).join(' ');
  const statusText = !showList
    ? ''
    : loading
      ? 'Searching…'
      : failed
        ? 'City search is unavailable right now'
        : results.length
          ? `${results.length} ${results.length === 1 ? 'city' : 'cities'} found. Use up and down arrows to choose.`
          : 'No matching cities';

  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint={hint}
      error={error}
      optional={optional}
      hideLabel={hideLabel}
      className={cx('combobox', className)}
      hintId={hintId}
      errorId={errorId}
    >
      <div className="combobox__anchor">
        <div className="input-wrap input-wrap--prefix">
          <span className="input-wrap__prefix" aria-hidden="true">
            <Icon name="pin" size={18} />
          </span>
          <input
            id={inputId}
            className="input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            placeholder={placeholder}
            value={text}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={(e) => {
              pendingPick.current = null;
              setDirty(true);
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={(e) => e.target.select()}
            onKeyDown={onKeyDown}
            onBlur={restore}
          />
          {loading ? (
            <span className="input-wrap__suffix">
              <Spinner size={16} />
            </span>
          ) : value && !disabled ? (
            <button
              type="button"
              className="input-wrap__clear"
              aria-label={`Clear ${label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDirty(false);
                setText('');
                onChange(null);
              }}
            >
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="combobox__list"
          hidden={!showList || results.length === 0}
        >
          {results.map((city, i) => (
            <li
              key={city.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx('combobox__option', i === active && 'combobox__option--active')}
              // mousedown keeps focus in the input so blur does not reset before the click lands
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(city)}
              onMouseMove={() => setActive(i)}
            >
              <span className="combobox__name">{city.name}</span>
              <span className="combobox__state">{city.state}</span>
            </li>
          ))}
        </ul>
      </div>
      {showList && !loading && results.length === 0 ? (
        <p className="combobox__empty">
          {failed ? 'City search is unavailable right now.' : 'No matching cities. Try the city name only.'}
        </p>
      ) : null}
      <span id={statusId} className="visually-hidden" aria-live="polite">
        {statusText}
      </span>
    </Field>
  );
}
