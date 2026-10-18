import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  HOTSHOT_MAX_LENGTH_FT,
  HOTSHOT_MAX_PAYLOAD_LBS,
  NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS,
} from '../../../../shared/equipment';
import { roadMiles } from '../../../../shared/geo';
import type { BookingMode, City, EquipmentCode, Load, LoadSize } from '../../../../shared/types';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { CityInput } from '../../components/CityInput';
import { DetailList } from '../../components/DataDisplay';
import { DateTimeInput } from '../../components/DateTimeInput';
import { EquipmentChips, EquipmentPicker } from '../../components/Equipment';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Checkbox, NumberInput, RadioCards, Switch, TextArea, TextInput, type RadioCardOption } from '../../components/Form';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { api, ApiError, errorMessage, isApiError } from '../../lib/api';
import { useSignedInUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { lane, lbs, loadStatusLabel, miles, money, place, plural, ratePerMile, timeWindow } from '../../lib/format';
import { useApi, useIsDesktop } from '../../lib/hooks';
import { useServerEvent } from '../../lib/realtime';
import { paths } from '../../lib/routes';
import {
  addHours,
  apiErrorsToFields,
  emptyLoadValues,
  hasErrors,
  hotshotFit,
  isOpenToHotshot,
  LOAD_LIMITS,
  lengthLabel,
  loadToValues,
  pickupWindowChanged,
  setOpenToHotshot,
  toLoadInput,
  toLoadUpdate,
  validateLoad,
  type LoadField,
  type LoadFormErrors,
  type LoadFormValues,
} from './components/loadForm';
import { RateEstimatePanel } from './components/RateEstimatePanel';
import './shipper.css';

type Mode = 'new' | 'edit' | 'repost';

const DEFAULT_WINDOW_HOURS = 4;

const LOAD_SIZE_OPTIONS: RadioCardOption<LoadSize>[] = [
  { value: 'full', title: 'Full load', description: 'Takes the whole deck or trailer.' },
  { value: 'partial', title: 'Partial', description: 'Leaves room, so the driver can add other freight.' },
];

const BOOKING_OPTIONS: RadioCardOption<BookingMode>[] = [
  {
    value: 'instant',
    title: 'Instant book',
    media: <Icon name="bolt" size={22} />,
    description:
      'The first qualified driver to tap Book gets the load at your rate. No back and forth. Best when it has to move today.',
  },
  {
    value: 'request',
    title: 'Review requests',
    media: <Icon name="users" size={22} />,
    description: 'Drivers send a request, sometimes with a counter-offer. You see their rig and pick who hauls it.',
  },
];

const laneMiles = (origin: City | null, destination: City | null): number | null =>
  origin && destination && origin.id !== destination.id ? Math.max(1, roadMiles(origin, destination)) : null;

// ---------------------------------------------------------------------------
// Hotshot switch
// ---------------------------------------------------------------------------

interface HotshotPanelProps {
  equipment: EquipmentCode[];
  weightLbs: number | null;
  lengthFt: number | null;
  onChange: (codes: EquipmentCode[]) => void;
}

function HotshotPanel({ equipment, weightLbs, lengthFt, onChange }: HotshotPanelProps) {
  const on = isOpenToHotshot(equipment);
  const fit = hotshotFit(weightLbs, lengthFt);
  const limits = `${HOTSHOT_MAX_LENGTH_FT} ft deck, ${lbs(HOTSHOT_MAX_PAYLOAD_LBS)} max`;

  let description: string;
  if (!fit.fits) description = 'This freight is bigger than a typical hotshot can haul.';
  else if (on) description = 'Gooseneck and dovetail hotshots now see this load in their matches, on top of semi drivers.';
  else if (!fit.known) description = `Adds gooseneck and dovetail hotshots, if the freight fits (${limits}).`;
  else description = `This freight fits a hotshot (${limits}). Turn on to add gooseneck and dovetail hotshots.`;

  return (
    <div className={cx('sh-hotshot', on && fit.fits && 'sh-hotshot--on')}>
      <Switch
        label="Open to hotshot"
        description={description}
        checked={on}
        onChange={(next) => onChange(setOpenToHotshot(equipment, next))}
      />
      {fit.fits && !on ? (
        <p className="text-sm">
          <strong>More drivers will see it.</strong> Hotshots are 1-ton duallies pulling a 30–40 ft gooseneck. On
          smaller, time-critical freight they often roll same day and cost less than a semi.
        </p>
      ) : null}
      {fit.fits && fit.needsCdl ? (
        <p className="text-sm muted">
          Over {lbs(NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS)}, so only hotshots with a CDL can take it.
        </p>
      ) : null}
      {!fit.fits ? (
        <InlineAlert tone="warn" title={on ? 'Hotshots won’t match this load' : 'Too big for most hotshots'}>
          <ul>
            {fit.problems.map((problem) => (
              <li key={problem}>{problem}.</li>
            ))}
          </ul>
          <p>{on ? 'Turn this off, or split the freight so it fits.' : 'Semi equipment is the better fit.'}</p>
        </InlineAlert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop summary
// ---------------------------------------------------------------------------

interface SummaryProps {
  values: LoadFormValues;
  submitLabel: string;
  submitting: boolean;
  disabled: boolean;
  cancelTo: string;
  formError: string | null;
}

function Summary({ values, submitLabel, submitting, disabled, cancelTo, formError }: SummaryProps) {
  const distance = laneMiles(values.origin, values.destination);
  const items = [
    { label: 'Miles', value: distance ? miles(distance) : '—' },
    {
      label: 'Pickup',
      value: values.pickupStart ? timeWindow(values.pickupStart, values.pickupEnd) : '—',
    },
    {
      label: 'Freight',
      value:
        values.weightLbs !== null && values.lengthFt !== null
          ? `${lbs(values.weightLbs)} · ${lengthLabel(values.lengthFt)}`
          : '—',
    },
    {
      label: 'Rate',
      value:
        values.rateUsd !== null
          ? `${money(values.rateUsd)}${distance ? ` · ${ratePerMile(values.rateUsd / distance)}` : ''}`
          : '—',
      strong: true,
    },
    { label: 'Booking', value: values.bookingMode === 'instant' ? 'Instant book' : 'Review requests' },
  ];
  return (
    <Card as="section" title="At a glance" className="stack">
      <p className="sh-summary-lane">
        {values.origin && values.destination ? lane(values.origin, values.destination) : 'Pick a lane to start'}
      </p>
      {values.equipmentTypes.length > 0 ? (
        <EquipmentChips codes={values.equipmentTypes} />
      ) : (
        <p className="muted text-sm">No trailer types picked yet</p>
      )}
      <DetailList items={items} />
      {formError ? (
        <InlineAlert tone="bad" title="Not saved yet">
          {formError}
        </InlineAlert>
      ) : null}
      <Button type="submit" size="lg" block loading={submitting} disabled={disabled}>
        {submitLabel}
      </Button>
      <ButtonLink to={cancelTo} variant="ghost" block>
        Cancel
      </ButtonLink>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

interface LoadFormProps {
  mode: Mode;
  /** The load being edited or reposted. */
  source: Load | null;
}

function focusFirstError(form: HTMLFormElement | null) {
  // Wait for the error state to render, then put the cursor on the first problem.
  requestAnimationFrame(() => {
    const el = form?.querySelector<HTMLElement>('[aria-invalid="true"], .field--invalid input, .field--invalid textarea');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  });
}

function LoadForm({ mode, source }: LoadFormProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<LoadFormValues>(() =>
    source ? loadToValues(source, mode === 'edit' ? 'edit' : 'repost', new Date()) : emptyLoadValues(new Date()),
  );
  const [errors, setErrors] = useState<LoadFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Why saving is blocked: a driver booked (or you cancelled) the load while it was being edited. */
  const [locked, setLocked] = useState<string | null>(null);
  const [minPickup] = useState(() => new Date().toISOString());

  useServerEvent((event) => {
    if (mode === 'edit' && source && event.type === 'load_updated' && event.loadId === source.id && event.status !== 'open') {
      setLocked(`It’s ${loadStatusLabel(event.status).toLowerCase()} now, and only open loads can be edited.`);
    }
  });

  const clearErrors = (...fields: LoadField[]) => {
    if (fields.some((f) => errors[f])) {
      setErrors((prev) => {
        const next = { ...prev };
        for (const f of fields) delete next[f];
        return next;
      });
    }
  };

  const set = <K extends LoadField>(field: K, value: LoadFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    clearErrors(field);
  };

  const setPickupStart = (iso: string | null) => {
    setValues((v) => {
      const next = { ...v, pickupStart: iso };
      // Keep the window valid: an end before the new start moves to start + 4h.
      if (iso && (!v.pickupEnd || Date.parse(v.pickupEnd) < Date.parse(iso))) {
        next.pickupEnd = addHours(iso, DEFAULT_WINDOW_HOURS);
      }
      return next;
    });
    clearErrors('pickupStart', 'pickupEnd');
  };

  // Field problems clear as they are fixed, so the summary line follows them; server failures stay until the next try.
  const alert = formError ?? (hasErrors(errors) ? 'Check the highlighted fields.' : null);
  const distance = laneMiles(values.origin, values.destination);
  const sameCity = values.origin !== null && values.destination !== null && values.origin.id === values.destination.id;
  const cancelTo = source ? paths.shipperLoad(source.id) : paths.shipperHome;
  const submitLabel = mode === 'edit' ? 'Save changes' : 'Post load';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || locked) return;
    const checkFuturePickup = mode !== 'edit' || (source !== null && pickupWindowChanged(values, source));
    const found = validateLoad(values, { now: new Date(), checkFuturePickup });
    setErrors(found);
    setFormError(null);
    if (hasErrors(found)) {
      focusFirstError(formRef.current);
      return;
    }

    setSubmitting(true);
    try {
      let saved: Load;
      if (mode === 'edit' && source) {
        const update = toLoadUpdate(values, source);
        if (Object.keys(update).length === 0) {
          toast.info('Nothing changed', 'The load is the same as before.');
          navigate(paths.shipperLoad(source.id));
          return;
        }
        saved = await api.loads.update(source.id, update);
        toast.success(
          'Changes saved',
          source.pendingRequestCount > 0
            ? `We told the ${plural(source.pendingRequestCount, 'driver')} with requests what changed.`
            : `${lane(saved.origin, saved.destination)} is updated on the board.`,
        );
      } else {
        saved = await api.loads.create(toLoadInput(values));
        toast.success(
          'Load posted',
          `${lane(saved.origin, saved.destination)} is live. Drivers whose rigs fit are being matched now.`,
        );
      }
      navigate(paths.shipperLoad(saved.id));
    } catch (err) {
      const fields = err instanceof ApiError ? apiErrorsToFields(err) : {};
      if (hasErrors(fields)) {
        setErrors(fields);
        focusFirstError(formRef.current);
      } else {
        if (isApiError(err) && err.status === 409) setLocked(errorMessage(err));
        else setFormError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const sections = (
    <div className="stack-lg">
      {mode === 'edit' && source && source.pendingRequestCount > 0 ? (
        <InlineAlert tone="info" title={`${plural(source.pendingRequestCount, 'driver')} asked for this load`}>
          They’ll get a heads-up with what changed when you save.
        </InlineAlert>
      ) : null}
      {locked ? (
        <InlineAlert
          tone="warn"
          title="This load can’t be changed now"
          action={
            source ? (
              <ButtonLink to={paths.shipperLoad(source.id)} variant="secondary" size="sm">
                View load
              </ButtonLink>
            ) : null
          }
        >
          {locked}
        </InlineAlert>
      ) : null}

      <Card as="section" title="Lane" subtitle="Where it picks up and where it delivers.">
        <div className="form">
          <div className="form-row">
            <CityInput
              id="load-origin"
              label="Pickup city"
              value={values.origin}
              onChange={(city) => set('origin', city)}
              error={errors.origin}
              required
            />
            <CityInput
              id="load-destination"
              label="Delivery city"
              placeholder="City, e.g. Midland, TX"
              value={values.destination}
              onChange={(city) => set('destination', city)}
              error={errors.destination}
              required
            />
          </div>
          {distance ? (
            <p className="sh-lane-miles num" aria-live="polite">
              <Icon name="route" size={18} />
              About {miles(distance)} by road
            </p>
          ) : sameCity ? (
            <p className="text-sm text-warn" aria-live="polite">
              Pickup and delivery are the same city. Pick a different delivery city.
            </p>
          ) : null}
        </div>
      </Card>

      <Card as="section" title="Timing" subtitle="Drivers only see loads they can reach in time.">
        <div className="form">
          <div className="form-row">
            <DateTimeInput
              id="load-pickup-start"
              label="Pickup opens"
              value={values.pickupStart}
              onChange={setPickupStart}
              min={mode === 'edit' ? undefined : minPickup}
              error={errors.pickupStart}
              required
            />
            <DateTimeInput
              id="load-pickup-end"
              label="Pickup closes"
              value={values.pickupEnd}
              onChange={(iso) => set('pickupEnd', iso)}
              min={values.pickupStart}
              error={errors.pickupEnd}
              required
            />
          </div>
          <DateTimeInput
            id="load-deliver-by"
            label="Deliver by"
            value={values.deliveryBy}
            onChange={(iso) => set('deliveryBy', iso)}
            min={values.pickupStart}
            error={errors.deliveryBy}
            optional
            hint="Leave empty if there’s no hard deadline."
          />
        </div>
      </Card>

      <Card as="section" title="Freight" subtitle="What’s on the deck, so drivers know it fits.">
        <div className="form">
          <TextInput
            id="load-commodity"
            label="Commodity"
            value={values.commodity}
            onChange={(e) => set('commodity', e.target.value)}
            maxLength={LOAD_LIMITS.commodityMax}
            placeholder="Drill pipe, pallets of tile, a skid steer…"
            error={errors.commodity}
            required
          />
          <div className="form-row">
            <NumberInput
              id="load-weight"
              label="Weight"
              value={values.weightLbs}
              onChange={(n) => set('weightLbs', n)}
              suffix="lbs"
              hint={`Total, up to ${lbs(LOAD_LIMITS.weightMax)}.`}
              error={errors.weightLbs}
              required
            />
            <NumberInput
              id="load-length"
              label="Length"
              decimal
              value={values.lengthFt}
              onChange={(n) => set('lengthFt', n)}
              suffix="ft"
              hint="Deck space it takes up."
              error={errors.lengthFt}
              required
            />
          </div>
          <RadioCards
            label="Load size"
            options={LOAD_SIZE_OPTIONS}
            value={values.loadSize}
            onChange={(size) => set('loadSize', size)}
            columns={2}
          />
          <div className="stack-sm">
            <Checkbox
              label="Hazmat"
              description="Placarded hazardous materials. Only CDL drivers with the H endorsement can book it."
              checked={values.hazmat}
              onChange={(on) => set('hazmat', on)}
            />
            <Checkbox
              label="Tarp required"
              description="The driver brings tarps and covers the freight."
              checked={values.tarpRequired}
              onChange={(on) => set('tarpRequired', on)}
            />
            <Checkbox
              label="Team drivers"
              description="Two drivers, so the truck keeps rolling around the clock."
              checked={values.teamRequired}
              onChange={(on) => set('teamRequired', on)}
            />
          </div>
          <TextArea
            id="load-notes"
            label="Notes for the driver"
            optional
            rows={3}
            maxLength={LOAD_LIMITS.notesMax}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Dock hours, straps or chains, who to call on site, appointment number…"
            error={errors.notes}
          />
        </div>
      </Card>

      <Card as="section" title="Equipment" subtitle="Every trailer type you’ll accept. More types, more drivers.">
        <div className="form">
          <HotshotPanel
            equipment={values.equipmentTypes}
            weightLbs={values.weightLbs}
            lengthFt={values.lengthFt}
            onChange={(codes) => set('equipmentTypes', codes)}
          />
          <EquipmentPicker
            label="Trailer types"
            value={values.equipmentTypes}
            onChange={(codes) => set('equipmentTypes', codes)}
            error={errors.equipmentTypes}
          />
        </div>
      </Card>

      <Card as="section" title="Rate" subtitle="All-in, in whole dollars: linehaul plus fuel.">
        <div className="sh-rate">
          <NumberInput
            id="load-rate"
            label="Your rate"
            value={values.rateUsd}
            onChange={(n) => set('rateUsd', n)}
            prefix="$"
            hint={
              values.rateUsd !== null && distance
                ? `${ratePerMile(values.rateUsd / distance)} on ${miles(distance)}`
                : `$${LOAD_LIMITS.rateMin} to $${LOAD_LIMITS.rateMax.toLocaleString('en-US')}.`
            }
            error={errors.rateUsd}
            required
          />
          <RateEstimatePanel
            origin={values.origin}
            destination={values.destination}
            equipment={values.equipmentTypes}
            rateUsd={values.rateUsd}
            onUseSuggested={(usd) => set('rateUsd', usd)}
          />
        </div>
      </Card>

      <Card as="section" title="Booking" subtitle="How a driver gets this load.">
        <div className="form">
          <RadioCards
            label="How drivers book"
            hideLabel
            options={BOOKING_OPTIONS}
            value={values.bookingMode}
            onChange={(next) => set('bookingMode', next)}
            columns={2}
            error={errors.bookingMode}
          />
          <TextInput
            id="load-reference"
            label="Reference number"
            optional
            value={values.referenceNumber}
            onChange={(e) => set('referenceNumber', e.target.value)}
            maxLength={LOAD_LIMITS.referenceMax}
            hint="Your PO, BOL or order number. Drivers see it on the load."
            error={errors.referenceNumber}
            autoComplete="off"
          />
        </div>
      </Card>
    </div>
  );

  return (
    <form ref={formRef} className="stack-lg" onSubmit={(e) => void onSubmit(e)} noValidate aria-busy={submitting || undefined}>
      {isDesktop ? (
        <div className="layout-sidebar">
          {sections}
          <aside className="sticky-panel">
            <Summary
              values={values}
              submitLabel={submitLabel}
              submitting={submitting}
              disabled={locked !== null}
              cancelTo={cancelTo}
              formError={alert}
            />
          </aside>
        </div>
      ) : (
        <>
          {sections}
          {alert ? (
            <InlineAlert tone="bad" title="Not saved yet">
              {alert}
            </InlineAlert>
          ) : null}
          <div className="action-bar">
            <Button type="submit" size="lg" loading={submitting} disabled={locked !== null}>
              {submitLabel}
            </Button>
            <ButtonLink to={cancelTo} variant="secondary" size="lg">
              Cancel
            </ButtonLink>
          </div>
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page: picks the mode and loads the source load for edit/repost
// ---------------------------------------------------------------------------

function FormSkeleton() {
  return (
    <div className="stack-lg" aria-busy="true">
      {[3, 2, 4].map((lines, i) => (
        <div key={i} className="card stack" aria-hidden="true">
          <Skeleton width="30%" height={18} />
          <Skeleton lines={lines} height={16} />
        </div>
      ))}
      <span className="visually-hidden" role="status">
        Loading the load
      </span>
    </div>
  );
}

function PostLoadScreen({ mode, sourceId }: { mode: Mode; sourceId: string | null }) {
  const user = useSignedInUser();
  const source = useApi((signal) => api.loads.get(sourceId!, { signal }), [sourceId], { enabled: sourceId !== null });
  const load = source.data?.load ?? null;

  const title = mode === 'edit' ? 'Edit load' : mode === 'repost' ? 'Repost a load' : 'Post a load';
  const back =
    sourceId !== null ? { to: paths.shipperLoad(sourceId), label: 'Back to the load' } : { to: paths.shipperHome, label: 'Dashboard' };
  const subtitle =
    mode === 'new'
      ? 'Drivers whose rigs fit get matched the moment it’s posted.'
      : load
        ? mode === 'edit'
          ? `${lane(load.origin, load.destination)} · ${load.commodity}`
          : `Copied from ${place(load.origin)} → ${place(load.destination)}. Set new pickup dates.`
        : undefined;

  let body;
  if (mode === 'new') {
    body = <LoadForm mode="new" source={null} />;
  } else if (!load && source.error) {
    body = (
      <ErrorState
        error={source.error}
        title={isApiError(source.error) && source.error.status === 404 ? 'We couldn’t find that load' : 'Couldn’t load it'}
        onRetry={() => void source.reload()}
      />
    );
  } else if (!load) {
    body = <FormSkeleton />;
  } else if (load.shipperId !== user.id) {
    body = (
      <EmptyState
        icon="warning"
        title={mode === 'edit' ? 'You can only edit your own loads' : 'You can only repost your own loads'}
        action={<ButtonLink to={paths.shipperNewLoad}>Post a new load</ButtonLink>}
      >
        <p>This load was posted by another shipper.</p>
      </EmptyState>
    );
  } else if (mode === 'edit' && load.status !== 'open') {
    body = (
      <EmptyState
        icon="warning"
        title="This load can’t be edited"
        action={
          <>
            <ButtonLink to={paths.shipperLoad(load.id)} variant="secondary">
              Back to the load
            </ButtonLink>
            <ButtonLink to={paths.shipperRepost(load.id)} icon="copy">
              Repost a copy
            </ButtonLink>
          </>
        }
      >
        <p>
          It’s {loadStatusLabel(load.status).toLowerCase()}, and only open loads can be changed. Repost it to put the same
          freight back on the board.
        </p>
      </EmptyState>
    );
  } else {
    body = <LoadForm mode={mode} source={load} />;
  }

  return (
    <div className="stack-lg sh-page">
      <PageHeader title={title} subtitle={subtitle} back={back} />
      {body}
    </div>
  );
}

export default function PostLoadPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const fromId = id ? null : params.get('from');
  const mode: Mode = id ? 'edit' : fromId ? 'repost' : 'new';
  const sourceId = id ?? fromId ?? null;
  // New, edit and repost share one route element; a fresh key resets the form when switching between them.
  return <PostLoadScreen key={`${mode}:${sourceId ?? ''}`} mode={mode} sourceId={sourceId} />;
}
