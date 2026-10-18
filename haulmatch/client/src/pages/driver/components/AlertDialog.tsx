import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DriverClass, LoadSearchFilters, SavedSearch } from '../../../../../shared/types';
import { Button } from '../../../components/Button';
import { InlineAlert } from '../../../components/Feedback';
import { Switch, TextInput } from '../../../components/Form';
import { Modal } from '../../../components/Modal';
import { ApiError, api, errorMessage } from '../../../lib/api';
import { describeFilters } from '../../../lib/filters';
import { place } from '../../../lib/format';
import { useCity } from './cities';
import {
  draftFromFilters,
  emptyDraft,
  filterErrorsFromPaths,
  filtersForAlert,
  filtersFromDraft,
  validateFilterDraft,
  type FilterDraft,
  type FilterErrors,
} from './filterDraft';
import { LoadFilterFields } from './LoadFilterFields';

const NAME_MAX = 60;

/** A readable default name from the filters, cut to the API's 60 characters. */
export function suggestAlertName(filters: LoadSearchFilters, cityLabel?: string): string {
  const summary = describeFilters(filters, cityLabel);
  const base = summary === describeFilters({}) ? 'Every load that fits my rig' : summary;
  return base.length > NAME_MAX ? `${base.slice(0, NAME_MAX - 1).trimEnd()}…` : base;
}

export interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  driverClass: DriverClass;
  /** Edit this saved search; omit to create a new one. */
  search?: SavedSearch | null;
  /**
   * Save these filters as they are (the board's "Save as alert"): the dialog shows a summary
   * and asks only for a name. Without it the full filter controls are shown.
   */
  fixedFilters?: LoadSearchFilters;
  onSaved: (search: SavedSearch, created: boolean) => void;
}

/** Create or edit a saved search (load alert). */
export function AlertDialog({ open, onClose, driverClass, search, fixedFilters, onSaved }: AlertDialogProps) {
  const editing = Boolean(search);
  const showFields = editing || !fixedFilters;
  const startFilters = search?.filters ?? fixedFilters ?? {};
  const originCity = useCity(startFilters.originCityId);
  const cityLabel = originCity?.state ? place(originCity) : undefined;

  const [name, setName] = useState('');
  const nameTouched = useRef(false);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [nameError, setNameError] = useState<string | null>(null);
  const [filterErrors, setFilterErrors] = useState<FilterErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    nameTouched.current = editing;
    setName(search?.name ?? suggestAlertName(startFilters, cityLabel));
    setAlertsEnabled(search?.alertsEnabled ?? true);
    setDraft(draftFromFilters(startFilters, originCity));
    setNameError(null);
    setFilterErrors({});
    setFormError(null);
    // Only re-run when the dialog opens or switches to another search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search?.id]);

  // The origin city's real name can arrive after opening ("St. Louis" instead of "St Louis").
  useEffect(() => {
    if (!open || !originCity) return;
    setDraft((prev) => (prev.originCity?.id === originCity.id ? { ...prev, originCity } : prev));
    if (!nameTouched.current && !editing) setName(suggestAlertName(startFilters, cityLabel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originCity]);

  const filtersToSave = (): LoadSearchFilters =>
    filtersForAlert(fixedFilters && !editing ? fixedFilters : filtersFromDraft(draft, { sort: startFilters.sort }));

  const updateDraft = (patch: Partial<FilterDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!nameTouched.current) {
      const label = next.originCity?.state ? place(next.originCity) : undefined;
      setName(suggestAlertName(filtersFromDraft(next), label));
    }
    setFilterErrors((prev) => {
      const keys = Object.keys(patch);
      return keys.some((k) => k in prev) ? Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))) : prev;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const nameProblem = !trimmed ? 'Name this alert' : trimmed.length > NAME_MAX ? `Keep it under ${NAME_MAX} characters` : null;
    const draftProblems = showFields ? validateFilterDraft(draft) : {};
    setNameError(nameProblem);
    setFilterErrors(draftProblems);
    setFormError(null);
    if (nameProblem || Object.keys(draftProblems).length) return;

    setSaving(true);
    try {
      const input = { name: trimmed, filters: filtersToSave(), alertsEnabled };
      const saved = search ? await api.savedSearches.update(search.id, input) : await api.savedSearches.create(input);
      onSaved(saved, !search);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        const mapped = filterErrorsFromPaths(fields);
        if (fields.name) setNameError(fields.name);
        if (Object.keys(mapped).length) setFilterErrors(mapped);
        if (!fields.name && Object.keys(mapped).length === 0) setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const summary = describeFilters(filtersToSave(), cityLabel);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit alert' : fixedFilters ? 'Save as alert' : 'New alert'}
      description={
        editing
          ? 'Change the name or what it watches for.'
          : 'We’ll ping you when a load like this posts and fits your rig.'
      }
      size={showFields ? 'lg' : 'sm'}
      dismissible={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="drv-alert-form" loading={saving} icon={editing ? 'check' : 'siren'}>
            {editing ? 'Save changes' : 'Save alert'}
          </Button>
        </>
      }
    >
      <form id="drv-alert-form" className="stack-lg" onSubmit={submit} noValidate>
        {formError ? (
          <InlineAlert tone="bad" title="Couldn’t save the alert">
            {formError}
          </InlineAlert>
        ) : null}
        <TextInput
          label="Alert name"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => {
            nameTouched.current = true;
            setName(e.target.value);
            setNameError(null);
          }}
          error={nameError}
          required
        />
        {showFields ? (
          <LoadFilterFields
            draft={draft}
            onChange={updateDraft}
            driverClass={driverClass}
            errors={filterErrors}
            showIneligible={false}
          />
        ) : (
          <div className="card card--muted stack-xs">
            <p className="text-sm strong">Watching for</p>
            <p className="drv-alert__summary">{summary}</p>
            {fixedFilters?.includeIneligible ? (
              <p className="muted text-sm">Alerts only ping for loads that fit your rig.</p>
            ) : null}
          </div>
        )}
        <Switch
          label="Ping me about new loads"
          description="Notifications in the app. Turn off to keep it as a saved search only."
          checked={alertsEnabled}
          onChange={setAlertsEnabled}
        />
      </form>
    </Modal>
  );
}

