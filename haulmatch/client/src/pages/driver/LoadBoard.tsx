import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { City, DriverClass, DriverProfile, LoadSearchFilters, LoadSort, LoadWithMatch } from '../../../../shared/types';
import { Chip } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState, ErrorState, InlineAlert, LoadListSkeleton, Spinner } from '../../components/Feedback';
import { Select, Switch } from '../../components/Form';
import { Icon } from '../../components/Icon';
import { LoadCard } from '../../components/LoadCard';
import { LoadsMap } from '../../components/LoadsMap';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { LOAD_SORTS, activeFilterCount, filtersFromSearchParams, filtersToQueryString, filtersToSearchParams } from '../../lib/filters';
import { pickupTime, place, plural } from '../../lib/format';
import { useAction, useDocumentTitle, useIsDesktop, useNow } from '../../lib/hooks';
import { useServerEvent } from '../../lib/realtime';
import { paths } from '../../lib/routes';
import { AlertDialog } from './components/AlertDialog';
import { rememberBoardSearch } from './components/boardMemory';
import { useCity } from './components/cities';
import {
  draftFromFilters,
  filterChips,
  filtersFromDraft,
  validateFilterDraft,
  type FilterDraft,
  type FilterErrors,
} from './components/filterDraft';
import { LoadFilterFields } from './components/LoadFilterFields';
import { LocationDialog } from './components/LocationDialog';
import { PAGE_SIZE, useLoadBoard } from './components/useLoadBoard';
import { useCoalesced, useRefreshOnFocus } from './components/useRefreshOnFocus';
import './components/driver.css';

type View = 'list' | 'map';

export default function LoadBoardPage() {
  useDocumentTitle('Load board');
  const { driverProfile } = useAuth();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(params), [params]);
  const queryKey = filtersToQueryString(filters);
  const view: View = params.get('view') === 'map' ? 'map' : 'list';
  const board = useLoadBoard(filters, queryKey);
  const originCity = useCity(filters.originCityId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const driverClass: DriverClass = driverProfile?.driverClass ?? 'hotshot';

  useEffect(() => rememberBoardSearch(params.toString()), [params]);
  useEffect(() => setSelectedId(null), [queryKey]);

  const refreshSoon = useCoalesced(board.refresh);
  useServerEvent((e) => {
    if (e.type === 'load_updated') refreshSoon();
    else if (e.type === 'notification' && e.notification.type === 'load_match') refreshSoon();
  });
  useRefreshOnFocus(board.refresh);

  const go = (next: LoadSearchFilters, nextView: View = view) => {
    const search = filtersToSearchParams(next);
    if (nextView === 'map') search.set('view', 'map');
    setParams(search);
  };
  const applyFilters = (next: LoadSearchFilters) => go({ ...next, sort: filters.sort });
  const clearFilters = () => go({ sort: filters.sort });
  const setSort = (sort: LoadSort) => go({ ...filters, sort: sort === 'best' ? undefined : sort });
  const setView = (next: View) => {
    const search = new URLSearchParams(params);
    if (next === 'map') search.set('view', 'map');
    else search.delete('view');
    setParams(search, { replace: true });
  };

  const narrowing = activeFilterCount(filters);
  const chips = filterChips(filters, originCity, now);
  const data = board.data;
  const loads = data?.loads ?? [];

  const countText = !data
    ? 'Finding loads…'
    : filters.includeIneligible
      ? `${plural(data.total, 'load')}, including ones you can’t take`
      : narrowing > 0
        ? `${plural(data.total, 'load')} match your filters`
        : `${plural(data.total, 'load')} fit your rig`;

  return (
    <div className="stack-lg">
      <BoardHeader profile={driverProfile} onLocationSaved={board.refresh} />

      {data && !data.profileComplete ? (
        <InlineAlert
          tone="warn"
          title="Finish setting up your rig"
          action={
            <ButtonLink to={paths.driverSetup} size="sm" iconAfter="arrowRight">
              Finish setup
            </ButtonLink>
          }
        >
          Match scores, deadhead and profit show once your equipment, capacity and location are in.
        </InlineAlert>
      ) : null}

      <div className={isDesktop ? 'layout-sidebar-left' : 'stack'}>
        {isDesktop ? (
          <aside aria-label="Filters">
            <Card title="Filters" subtitle={narrowing ? plural(narrowing, 'filter') + ' on' : 'Narrow the board'}>
              <FilterPanel
                key={queryKey}
                filters={filters}
                originCity={originCity}
                driverClass={driverClass}
                onApply={applyFilters}
                onClear={clearFilters}
              />
            </Card>
          </aside>
        ) : null}

        <section className="stack" aria-label="Loads">
          <div className="drv-toolbar">
            {!isDesktop ? (
              <Button variant="secondary" icon="sliders" onClick={() => setSheetOpen(true)}>
                Filters
                {narrowing ? (
                  <>
                    {' '}
                    <span className="drv-count" aria-hidden="true">
                      {narrowing}
                    </span>
                    <span className="visually-hidden">, {narrowing} on</span>
                  </>
                ) : null}
              </Button>
            ) : null}
            <Select
              label="Sort loads"
              hideLabel
              fieldClassName="drv-toolbar__sort"
              value={filters.sort ?? 'best'}
              onChange={setSort}
              options={LOAD_SORTS}
            />
            {isDesktop ? <ViewToggle view={view} onChange={setView} /> : null}
          </div>

          <div className={isDesktop ? 'row' : 'scroll-row'} role="group" aria-label="This search">
            <Chip icon="siren" onClick={() => setAlertOpen(true)} disabled={!data}>
              Save as alert
            </Chip>
            {chips.map((chip) => (
              <Chip key={chip.key} removable onClick={() => go(chip.without(filters))} aria-label={`Remove filter: ${chip.label}`}>
                {chip.label}
              </Chip>
            ))}
            {chips.length > 1 ? (
              <button type="button" className="link-button" onClick={clearFilters}>
                Clear all
              </button>
            ) : null}
          </div>

          <div className="drv-results">
            <p className="drv-results__count" aria-live="polite">
              {countText}
              {board.refreshing ? (
                <>
                  {' '}
                  <Spinner size={14} />
                </>
              ) : null}
            </p>
            {!isDesktop ? <ViewToggle view={view} onChange={setView} compact /> : null}
          </div>

          {board.loading && !data ? (
            <LoadListSkeleton count={4} />
          ) : board.error && !data ? (
            <ErrorState error={board.error} title="Couldn’t load the board" onRetry={board.reload} />
          ) : loads.length === 0 ? (
            <BoardEmpty
              filtered={narrowing > 0}
              includeIneligible={Boolean(filters.includeIneligible)}
              onClear={clearFilters}
              onShowIneligible={() => applyFilters({ ...filters, includeIneligible: true })}
              onSaveAlert={() => setAlertOpen(true)}
            />
          ) : view === 'map' ? (
            <MapResults
              loads={loads}
              total={data?.total ?? loads.length}
              selectedId={selectedId}
              onSelect={setSelectedId}
              driverLocation={driverProfile?.currentLocation ?? null}
              isDesktop={isDesktop}
              now={now}
              more={<LoadMore board={board} shown={loads.length} total={data?.total ?? 0} />}
            />
          ) : (
            <>
              <ul className="list-reset stack" aria-label="Load results">
                {loads.map((load) => (
                  <li key={load.id}>
                    <LoadCard load={load} match={load.match} href={paths.driverLoad(load.id)} now={now} />
                  </li>
                ))}
              </ul>
              <LoadMore board={board} shown={loads.length} total={data?.total ?? 0} />
            </>
          )}
        </section>
      </div>

      {!isDesktop ? (
        <FilterSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          filters={filters}
          originCity={originCity}
          driverClass={driverClass}
          onApply={(next) => {
            applyFilters(next);
            setSheetOpen(false);
          }}
          onClear={() => {
            clearFilters();
            setSheetOpen(false);
          }}
        />
      ) : null}

      <AlertDialog
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        driverClass={driverClass}
        fixedFilters={filters}
        onSaved={() =>
          toast.show({
            tone: 'success',
            title: 'Alert saved',
            body: 'We’ll ping you when a load like this posts.',
            link: { to: paths.driverAlerts, label: 'Manage alerts' },
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header: where the driver is, and whether they are taking loads
// ---------------------------------------------------------------------------

function BoardHeader({ profile, onLocationSaved }: { profile: DriverProfile | null; onLocationSaved: () => void }) {
  const { setDriverProfile } = useAuth();
  const toast = useToast();
  const [locationOpen, setLocationOpen] = useState(false);
  const toggle = useAction((available: boolean) => api.drivers.updateMyProfile({ available }));

  const setAvailable = async (available: boolean) => {
    const saved = await toggle.run(available);
    if (saved) {
      setDriverProfile(saved);
      toast.success(
        available ? 'You’re taking loads' : 'You’re off the board',
        available ? 'Hot-match pings are back on.' : 'No hot-match pings until you switch back. You can still book.',
      );
    }
  };

  useEffect(() => {
    if (toggle.error) toast.error('Couldn’t change availability', errorMessage(toggle.error));
    // Report each failure once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle.error]);

  const location = profile?.currentLocation ?? null;
  const later = profile?.availableFrom && Date.parse(profile.availableFrom) > Date.now() ? profile.availableFrom : null;

  return (
    <>
      <header className="drv-board-head">
        <h1 className="drv-board-head__title">Load board</h1>
        {profile ? (
          <Switch
            className="drv-avail"
            label="Taking loads"
            checked={profile.available}
            disabled={toggle.pending}
            onChange={(on) => void setAvailable(on)}
          />
        ) : null}
        <p className="drv-where">
          <Icon name="truck" size={18} />
          {!location ? (
            <span>No location set</span>
          ) : !profile?.available ? (
            <span>
              Off the board in <strong>{place(location)}</strong>
            </span>
          ) : (
            <span>
              Empty in <strong>{place(location)}</strong>
              {later ? ` from ${pickupTime(later)}` : ''}
            </span>
          )}
          {profile ? (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="link-button" onClick={() => setLocationOpen(true)}>
                {location ? 'Change' : 'Set location'}
                {location ? <span className="visually-hidden"> where you’re empty</span> : null}
              </button>
            </>
          ) : null}
        </p>
      </header>
      {profile ? (
        <LocationDialog
          open={locationOpen}
          onClose={() => setLocationOpen(false)}
          profile={profile}
          onSaved={onLocationSaved}
        />
      ) : null}
    </>
  );
}

function ViewToggle({ view, onChange, compact }: { view: View; onChange: (view: View) => void; compact?: boolean }) {
  const label = (text: string) => (compact ? <span className="visually-hidden">{text}</span> : text);
  return (
    <div className="drv-toolbar__view" role="group" aria-label="Show loads as">
      <Chip selected={view === 'list'} icon="menu" className={compact ? 'drv-icon-chip' : undefined} onClick={() => onChange('list')}>
        {label('List')}
      </Chip>
      <Chip selected={view === 'map'} icon="map" className={compact ? 'drv-icon-chip' : undefined} onClick={() => onChange('map')}>
        {label('Map')}
      </Chip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters: desktop sidebar and phone sheet share one draft model
// ---------------------------------------------------------------------------

interface FilterPanelProps {
  filters: LoadSearchFilters;
  originCity: City | null;
  driverClass: DriverClass;
  onApply: (filters: LoadSearchFilters) => void;
  onClear: () => void;
}

function useFilterDraft(filters: LoadSearchFilters, originCity: City | null) {
  const [draft, setDraft] = useState<FilterDraft>(() => draftFromFilters(filters, originCity));
  const [errors, setErrors] = useState<FilterErrors>({});

  // The real city record can arrive after the panel opened with a stand-in label.
  useEffect(() => {
    if (!originCity) return;
    setDraft((prev) => (prev.originCity?.id === originCity.id ? { ...prev, originCity } : prev));
  }, [originCity]);

  const update = (patch: Partial<FilterDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    const keys = Object.keys(patch);
    setErrors((prev) => (keys.some((k) => k in prev) ? Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))) : prev));
  };

  const reset = () => {
    setDraft(draftFromFilters(filters, originCity));
    setErrors({});
  };

  /** Validated filters, or null after showing the errors. */
  const result = (): LoadSearchFilters | null => {
    const found = validateFilterDraft(draft);
    setErrors(found);
    return Object.keys(found).length ? null : filtersFromDraft(draft, { sort: filters.sort });
  };

  const changed = filtersToQueryString(filtersFromDraft(draft, { sort: filters.sort })) !== filtersToQueryString(filters);
  return { draft, errors, update, reset, result, changed };
}

function FilterPanel({ filters, originCity, driverClass, onApply, onClear }: FilterPanelProps) {
  const form = useFilterDraft(filters, originCity);
  return (
    <form
      className="drv-filter-panel"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const next = form.result();
        if (next) onApply(next);
      }}
    >
      <LoadFilterFields draft={form.draft} onChange={form.update} driverClass={driverClass} errors={form.errors} />
      <div className="drv-filter-panel__actions">
        <Button variant="secondary" onClick={onClear} disabled={activeFilterCount(filters) === 0 && !filters.includeIneligible && !form.changed}>
          Clear all
        </Button>
        <Button type="submit" disabled={!form.changed}>
          Apply
        </Button>
      </div>
    </form>
  );
}

function FilterSheet({ open, onClose, ...props }: FilterPanelProps & { open: boolean; onClose: () => void }) {
  const form = useFilterDraft(props.filters, props.originCity);
  const { reset } = form;

  // Each opening starts from the filters that are applied now.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Filter loads"
      description="Only loads that fit your rig show unless you turn on “Show loads I can’t take”."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClear}>
            Clear all
          </Button>
          <Button type="submit" form="drv-filter-sheet" size="lg" icon="search">
            Show loads
          </Button>
        </>
      }
    >
      <form
        id="drv-filter-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const next = form.result();
          if (next) props.onApply(next);
        }}
      >
        <LoadFilterFields draft={form.draft} onChange={form.update} driverClass={props.driverClass} errors={form.errors} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function LoadMore({ board, shown, total }: { board: ReturnType<typeof useLoadBoard>; shown: number; total: number }) {
  if (shown >= total) {
    return shown > PAGE_SIZE ? <p className="muted text-sm text-center">That’s every load on the board for this search.</p> : null;
  }
  return (
    <div className="stack-sm">
      {board.moreError ? (
        <ErrorState compact error={board.moreError} title="Couldn’t load more loads" onRetry={board.loadMore} />
      ) : null}
      <Button variant="secondary" block icon="chevronDown" loading={board.loadingMore} onClick={board.loadMore}>
        Load more · {shown} of {total}
      </Button>
    </div>
  );
}

function MapResults({
  loads,
  total,
  selectedId,
  onSelect,
  driverLocation,
  isDesktop,
  now,
  more,
}: {
  loads: LoadWithMatch[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  driverLocation: DriverProfile['currentLocation'];
  isDesktop: boolean;
  now: Date;
  more: ReactNode;
}) {
  const selected = selectedId ? loads.find((l) => l.id === selectedId) ?? null : null;
  const atPickup = selected ? loads.filter((l) => l.origin.cityId === selected.origin.cityId) : [];
  return (
    <div className="stack">
      <LoadsMap
        loads={loads}
        hrefFor={(load) => paths.driverLoad(load.id)}
        selectedId={selectedId}
        onSelect={onSelect}
        driverLocation={driverLocation}
        height={isDesktop ? 560 : 'min(60vh, 480px)'}
      />
      {loads.length < total ? (
        <p className="drv-map-hint">
          Pins show the first {loads.length} of {total} loads. Load more to add pins.
        </p>
      ) : null}
      {selected ? (
        <div className="stack">
          <div className="row row-between">
            <h2 className="section-title">
              {atPickup.length === 1 ? 'Pickup in ' : `${atPickup.length} pickups in `}
              {place(selected.origin)}
            </h2>
            <button type="button" className="link-button" onClick={() => onSelect(null)}>
              Clear
            </button>
          </div>
          <ul className="list-reset stack">
            {atPickup.map((load) => (
              <li key={load.id}>
                <LoadCard load={load} match={load.match} href={paths.driverLoad(load.id)} now={now} selected={load.id === selectedId} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="drv-map-hint">Tap a pickup pin to see its loads here.</p>
      )}
      {more}
    </div>
  );
}

function BoardEmpty({
  filtered,
  includeIneligible,
  onClear,
  onShowIneligible,
  onSaveAlert,
}: {
  filtered: boolean;
  includeIneligible: boolean;
  onClear: () => void;
  onShowIneligible: () => void;
  onSaveAlert: () => void;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon="search"
        title="No loads match these filters"
        action={
          <div className="row row-center">
            <Button variant="secondary" onClick={onClear}>
              Clear filters
            </Button>
            {!includeIneligible ? (
              <Button variant="secondary" onClick={onShowIneligible}>
                Show loads I can’t take
              </Button>
            ) : null}
            <Button icon="siren" onClick={onSaveAlert}>
              Alert me when one posts
            </Button>
          </div>
        }
      >
        Try a bigger radius, fewer states or a lower $/mi. Pickups past your max deadhead are hidden unless you show
        loads you can’t take.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon="boxes"
      title="No loads fit your rig right now"
      action={
        <div className="row row-center">
          {!includeIneligible ? (
            <Button variant="secondary" onClick={onShowIneligible}>
              Show loads I can’t take
            </Button>
          ) : null}
          <ButtonLink to={paths.driverProfile} variant="secondary" icon="sliders">
            Widen my deadhead
          </ButtonLink>
          <Button icon="siren" onClick={onSaveAlert}>
            Alert me
          </Button>
        </div>
      }
    >
      New loads post all day. Set an alert and we’ll ping you, or update where you’re empty.
    </EmptyState>
  );
}
