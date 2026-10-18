import { useState } from 'react';
import type { DriverClass, SavedSearch } from '../../../../shared/types';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Switch } from '../../components/Form';
import { ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { describeFilters, filtersToQueryString } from '../../lib/filters';
import { shortDate } from '../../lib/format';
import { useAction, useApi } from '../../lib/hooks';
import { paths } from '../../lib/routes';
import { AlertDialog } from './components/AlertDialog';
import { useCityLabels } from './components/cities';
import './components/driver.css';

/** Matches MAX_SAVED_SEARCHES on the server. */
const MAX_ALERTS = 20;

type Editor = { mode: 'create' } | { mode: 'edit'; search: SavedSearch } | null;

export default function AlertsPage() {
  const { driverProfile } = useAuth();
  const toast = useToast();
  const list = useApi((signal) => api.savedSearches.list({ signal }), []);
  const [editor, setEditor] = useState<Editor>(null);
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);
  // DELETE resolves with no body; resolve true so a success is distinguishable from a failure.
  const remove = useAction((id: string) => api.savedSearches.remove(id).then(() => true));
  const searches = list.data ?? [];
  const labels = useCityLabels(searches.map((s) => s.filters.originCityId));
  const driverClass: DriverClass = driverProfile?.driverClass ?? 'hotshot';
  const atLimit = searches.length >= MAX_ALERTS;

  const replace = (saved: SavedSearch) =>
    list.setData((prev) => (prev ? prev.map((s) => (s.id === saved.id ? saved : s)) : prev));

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    const done = await remove.run(target.id);
    if (!done) return;
    list.setData((prev) => prev?.filter((s) => s.id !== target.id));
    setDeleting(null);
    toast.success('Alert deleted', `No more pings for “${target.name}”.`);
  };

  const openCreate = () => setEditor({ mode: 'create' });

  return (
    <div className="stack-lg">
      <PageHeader
        title="Load alerts"
        subtitle="Saved searches that ping you when a matching load posts and fits your rig."
        actions={
          <Button icon="plus" onClick={openCreate} disabled={atLimit || !list.data}>
            New alert
          </Button>
        }
      />

      {atLimit ? (
        <InlineAlert tone="info" title={`You’re at ${MAX_ALERTS} alerts`}>
          Delete one you don’t use to add another.
        </InlineAlert>
      ) : null}

      {list.loading && !list.data ? (
        <AlertsSkeleton />
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} title="Couldn’t load your alerts" onRetry={() => void list.reload()} />
      ) : searches.length === 0 ? (
        <EmptyState
          icon="siren"
          title="No alerts yet"
          action={
            <div className="row row-center">
              <Button icon="plus" onClick={openCreate}>
                Create an alert
              </Button>
              <ButtonLink to={paths.driverLoads} variant="secondary" icon="boxes">
                Go to the load board
              </ButtonLink>
            </div>
          }
        >
          Tell us the lanes you want: pickup area, delivery states, equipment, minimum $/mi. We’ll ping you as soon as a
          load like that posts. You can also tap “Save as alert” on the load board.
        </EmptyState>
      ) : (
        <>
          <p className="muted text-sm" aria-live="polite">
            {searches.length} of {MAX_ALERTS} alerts · {searches.filter((s) => s.alertsEnabled).length} pinging you
          </p>
          <ul className="list-reset grid-auto">
            {searches.map((search) => (
              <li key={search.id}>
                <AlertCard
                  search={search}
                  cityLabel={search.filters.originCityId ? labels[search.filters.originCityId] : undefined}
                  onSaved={replace}
                  onEdit={() => setEditor({ mode: 'edit', search })}
                  onDelete={() => {
                    remove.reset();
                    setDeleting(search);
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <AlertDialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        driverClass={driverClass}
        search={editor?.mode === 'edit' ? editor.search : null}
        onSaved={(saved, created) => {
          if (created) {
            list.setData((prev) => [saved, ...(prev ?? [])]);
            toast.success('Alert saved', 'We’ll ping you when a matching load posts.');
          } else {
            replace(saved);
            toast.success('Alert updated');
          }
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={deleting ? `Delete “${deleting.name}”?` : 'Delete alert?'}
        message="You’ll stop getting pings for these loads. This can’t be undone."
        confirmLabel="Delete alert"
        cancelLabel="Keep it"
        pending={remove.pending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      >
        {remove.error ? (
          <InlineAlert tone="bad" title="Couldn’t delete it">
            {errorMessage(remove.error)}
          </InlineAlert>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function AlertsSkeleton() {
  return (
    <ul className="list-reset grid-auto" aria-busy="true" aria-label="Loading alerts">
      {[0, 1, 2].map((i) => (
        <li key={i} className="card stack" aria-hidden="true">
          <Skeleton width="55%" height={18} />
          <Skeleton lines={2} />
          <Skeleton width="100%" height={44} radius="8px" />
        </li>
      ))}
    </ul>
  );
}

function AlertCard({
  search,
  cityLabel,
  onSaved,
  onEdit,
  onDelete,
}: {
  search: SavedSearch;
  cityLabel?: string;
  onSaved: (search: SavedSearch) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  // Show the new position right away; it snaps back if the save fails.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const enabled = optimistic ?? search.alertsEnabled;
  const viewLink = `${paths.driverLoads}?${filtersToQueryString(search.filters)}`;
  const summary = describeFilters(search.filters, cityLabel);

  const setEnabled = async (next: boolean) => {
    setOptimistic(next);
    setPending(true);
    try {
      const saved = await api.savedSearches.update(search.id, { alertsEnabled: next });
      onSaved(saved);
      toast.success(next ? 'Alert on' : 'Alert paused', next ? `We’ll ping you for “${search.name}”.` : `“${search.name}” is saved but quiet.`);
    } catch (err) {
      toast.error('Couldn’t change the alert', errorMessage(err));
    } finally {
      setOptimistic(null);
      setPending(false);
    }
  };

  return (
    <article className="card drv-alert" aria-labelledby={`alert-${search.id}`}>
      <div className="row row-between row-nowrap">
        <h2 id={`alert-${search.id}`} className="card__title break">
          {search.name}
        </h2>
        {enabled ? (
          <Badge tone="ok" icon="bell">
            On
          </Badge>
        ) : (
          <Badge tone="neutral">Paused</Badge>
        )}
      </div>
      {summary !== search.name ? <p className="drv-alert__summary">{summary}</p> : null}
      <Switch
        label="Ping me about new loads"
        description={`Saved ${shortDate(search.createdAt)}`}
        checked={enabled}
        disabled={pending}
        onChange={(next) => void setEnabled(next)}
      />
      <div className="drv-alert__actions">
        <ButtonLink to={viewLink} variant="secondary" icon="search">
          View loads
        </ButtonLink>
        <Button variant="ghost" icon="edit" onClick={onEdit} aria-label={`Rename or edit ${search.name}`}>
          Edit
        </Button>
        <Button variant="ghost" icon="trash" className="drv-alert__danger" onClick={onDelete} aria-label={`Delete ${search.name}`}>
          Delete
        </Button>
      </div>
    </article>
  );
}
