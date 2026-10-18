import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Shown as a small count next to the label (e.g. pending requests). */
  count?: number;
}

export interface TabsProps<T extends string> {
  /** Unique prefix for tab/panel ids; pass the same value to each TabPanel's `tabsId`. */
  id: string;
  /** Accessible name of the tab list. */
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Stretch tabs to fill the row (phones). */
  fill?: boolean;
  className?: string;
}

export const tabId = (tabsId: string, id: string) => `${tabsId}-tab-${id}`;
export const panelId = (tabsId: string, id: string) => `${tabsId}-panel-${id}`;

/**
 * ARIA tabs with arrow-key navigation (Left/Right/Home/End move and activate).
 *
 *   <Tabs id="trips" label="Trips" tabs={[{ id: 'active', label: 'Active' }, ...]} value={tab} onChange={setTab} />
 *   <TabPanel tabsId="trips" id="active" active={tab === 'active'}>...</TabPanel>
 */
export function Tabs<T extends string>({ id, label, tabs, value, onChange, fill, className }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className={cx('tabs', fill && 'tabs--fill', className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(id, tab.id)}
            tabIndex={selected ? 0 : -1}
            className={cx('tabs__tab', selected && 'tabs__tab--selected')}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 ? <span className="tabs__count num">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  tabsId: string;
  id: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}

/** Panel for one tab. Inactive panels are not rendered. */
export function TabPanel({ tabsId, id, active, children, className }: TabPanelProps) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={panelId(tabsId, id)} aria-labelledby={tabId(tabsId, id)} className={cx('tab-panel', className)}>
      {children}
    </div>
  );
}
