import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import type { Booking, DriverSummary, Load, RecommendedDriver, ServerEvent } from '../../../../shared/types';
import { Badge, StatusBadge, Tag } from '../../components/Badge';
import { Button, ButtonAnchor, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailList, type DetailItem } from '../../components/DataDisplay';
import { DriverCard } from '../../components/DriverCard';
import { EquipmentChips } from '../../components/Equipment';
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { RouteMap } from '../../components/RouteMap';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { useSignedInUser } from '../../lib/auth';
import { lane, lbs, miles, money, pickupTime, plural, ratePerMile, timeAgo, timeWindow } from '../../lib/format';
import { useAction, useApi, useIsDesktop, useNow } from '../../lib/hooks';
import { paths } from '../../lib/routes';
import { InviteDialog } from './components/InviteDialog';
import { lengthLabel } from './components/loadForm';
import { RequestCard } from './components/Requests';
import { shipperFitLine } from './components/shipperChecks';
import { StatusTimeline } from './components/StatusTimeline';
import { notificationLoadId, useLiveReload } from './components/useLiveReload';
import { useRequestDecisions, type RequestDecisions } from './components/useRequestDecisions';
import './shipper.css';

const RECOMMENDED_PREVIEW = 4;

function scrollToRequests() {
  const el = document.getElementById('requests');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function LoadSummary({ load, now, mapHeight }: { load: Load; now: Date; mapHeight: number }) {
  const items: DetailItem[] = [
    { label: 'Posted rate', value: `${money(load.rateUsd)} · ${ratePerMile(load.ratePerMile)}`, strong: true },
  ];
  if (load.bookedRateUsd !== null && load.bookedRateUsd !== load.rateUsd) {
    items.push({
      label: 'Booked at',
      value: `${money(load.bookedRateUsd)} · ${ratePerMile(load.bookedRateUsd / Math.max(1, load.miles))}`,
      strong: true,
    });
  }
  items.push(
    { label: 'Pickup', value: timeWindow(load.pickupStart, load.pickupEnd, now) },
    { label: 'Deliver by', value: load.deliveryBy ? pickupTime(load.deliveryBy, now) : 'No deadline' },
    { label: 'Loaded miles', value: miles(load.miles) },
    { label: 'Weight', value: lbs(load.weightLbs) },
    { label: 'Length', value: lengthLabel(load.lengthFt) },
    { label: 'Load size', value: load.loadSize === 'full' ? 'Full load' : 'Partial' },
    { label: 'Booking', value: load.bookingMode === 'instant' ? 'Instant book' : 'Review requests' },
    { label: 'Reference', value: load.referenceNumber ?? '—' },
  );

  const flags = [
    load.hazmat ? (
      <Badge key="hazmat" tone="bad" icon="hazard">
        Hazmat
      </Badge>
    ) : null,
    load.tarpRequired ? (
      <Badge key="tarp" tone="warn" icon="tarp">
        Tarp required
      </Badge>
    ) : null,
    load.teamRequired ? (
      <Badge key="team" tone="info" icon="users">
        Team drivers
      </Badge>
    ) : null,
    load.bookingMode === 'instant' ? (
      <Badge key="instant" tone="brand" icon="bolt">
        Instant book
      </Badge>
    ) : null,
  ].filter(Boolean);

  return (
    <Card as="section" title="Load details" actions={<StatusBadge kind="load" status={load.status} />}>
      <div className="stack">
        <RouteMap origin={load.origin} destination={load.destination} height={mapHeight} />
        <div className="stack-xs">
          <p className="text-sm strong muted">Trailer types accepted</p>
          <EquipmentChips codes={load.equipmentTypes} long />
        </div>
        {flags.length ? <div className="row">{flags}</div> : null}
        <DetailList items={items} columns={2} />
        {load.notes ? (
          <div className="stack-xs">
            <p className="text-sm strong muted">Notes for the driver</p>
            <p className="break">{load.notes}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="stack-lg" aria-busy="true">
      <div className="stack-sm" aria-hidden="true">
        <Skeleton width={120} height={14} />
        <Skeleton width="70%" height={30} />
        <Skeleton width="40%" height={16} />
      </div>
      <div className="card stack" aria-hidden="true">
        <Skeleton height={200} radius="var(--radius)" />
        <Skeleton lines={4} height={16} />
      </div>
      <span className="visually-hidden" role="status">
        Loading the load
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booked driver
// ---------------------------------------------------------------------------

interface BookedDriverProps {
  load: Load;
  driver: DriverSummary;
  booking: Booking | null;
  now: Date;
}

function BookedDriver({ load, driver, booking, now }: BookedDriverProps) {
  const first = driver.name.split(' ')[0];
  return (
    <section className="stack-sm" aria-labelledby="booked-driver-title">
      <h2 id="booked-driver-title" className="section-title">
        {load.status === 'delivered' ? 'Hauled by' : 'Your driver'}
      </h2>
      {/* No match score here: once the truck is rolling, a fresh match against today's location reads as "not a fit". */}
      <DriverCard
        driver={driver}
        actions={
          <>
            {driver.phone && load.status !== 'delivered' ? (
              <ButtonAnchor href={`tel:${driver.phone}`} icon="phone">
                Call {first}
              </ButtonAnchor>
            ) : null}
            <ButtonLink to={paths.thread(load.id, driver.userId)} variant="secondary" icon="message">
              Message
            </ButtonLink>
          </>
        }
      >
        <p className="row text-sm">
          <Icon name="dollar" size={16} className="muted" />
          <span>
            Booked at <strong className="num">{money(load.bookedRateUsd ?? load.rateUsd)}</strong>
            {booking ? ` · ${timeAgo(booking.updatedAt, now)}` : ''}
          </span>
        </p>
      </DriverCard>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

interface RequestsSectionProps {
  load: Load;
  bookings: Booking[] | undefined;
  error: unknown;
  onRetry: () => void;
  decisions: RequestDecisions;
  now: Date;
}

function RequestsSection({ load, bookings, error, onRetry, decisions, now }: RequestsSectionProps) {
  const [showPast, setShowPast] = useState(false);
  const pending = bookings?.filter((b) => b.status === 'pending') ?? [];
  // The accepted booking already has its own "Your driver" card.
  const past =
    bookings?.filter((b) => b.status !== 'pending' && !(b.status === 'accepted' && b.driverId === load.bookedDriverId)) ?? [];
  const open = load.status === 'open';
  // A covered load with no other requests: the driver card says it all.
  if (!open && bookings && pending.length === 0 && past.length === 0) return null;

  let body = null;
  if (!bookings && error) {
    body = <ErrorState compact error={error} title="Couldn’t load requests" onRetry={onRetry} />;
  } else if (!bookings) {
    body = (
      <div className="card stack" aria-busy="true">
        <Skeleton lines={3} height={16} />
        <span className="visually-hidden" role="status">
          Loading requests
        </span>
      </div>
    );
  } else if (pending.length === 0 && open) {
    body = (
      <div className="card card--muted stack-sm">
        <p className="strong">No requests waiting</p>
        <p className="muted text-sm">
          {load.bookingMode === 'instant'
            ? 'Instant book is on: the first qualified driver to tap Book gets the load, no review needed.'
            : 'Drivers whose rigs fit have been alerted. Invite one of the recommended drivers to speed it up.'}
        </p>
      </div>
    );
  } else if (pending.length > 0) {
    body = (
      <div className="stack">
        {pending.map((booking) => (
          <RequestCard
            key={booking.id}
            booking={booking}
            load={load}
            canDecide={open}
            busy={decisions.busyId === booking.id}
            locked={decisions.busyId !== null && decisions.busyId !== booking.id}
            onAccept={() => decisions.ask('accept', booking, load)}
            onDecline={() => decisions.ask('decline', booking, load)}
            now={now}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="stack-sm" aria-labelledby="requests-title" id="requests" tabIndex={-1}>
      <div className="row row-between">
        <h2 id="requests-title" className="section-title">
          Requests
        </h2>
        {pending.length > 0 ? (
          <Badge tone="warn" solid icon="users">
            {plural(pending.length, 'waiting', 'waiting')}
          </Badge>
        ) : null}
      </div>
      {body}
      {past.length > 0 ? (
        <>
          <button
            type="button"
            className="link-button"
            aria-expanded={showPast}
            aria-controls="past-requests"
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? 'Hide past requests' : `Show ${plural(past.length, 'past request')}`}
          </button>
          <div id="past-requests" className="stack" hidden={!showPast}>
            {showPast
              ? past.map((booking) => (
                  <RequestCard
                    key={booking.id}
                    booking={booking}
                    load={load}
                    canDecide={false}
                    busy={false}
                    locked={false}
                    onAccept={() => undefined}
                    onDecline={() => undefined}
                    now={now}
                  />
                ))
              : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recommended drivers
// ---------------------------------------------------------------------------

interface RecommendedSectionProps {
  load: Load;
  drivers: RecommendedDriver[] | undefined;
  error: unknown;
  onRetry: () => void;
  invited: Set<string>;
  onInvite: (driver: DriverSummary) => void;
}

function RecommendedSection({ load, drivers, error, onRetry, invited, onInvite }: RecommendedSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = drivers && !showAll ? drivers.slice(0, RECOMMENDED_PREVIEW) : drivers;

  let body;
  if (!drivers && error) {
    body = <ErrorState compact error={error} title="Couldn’t load recommended drivers" onRetry={onRetry} />;
  } else if (!drivers) {
    body = (
      <div className="grid-2" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="card stack-sm" aria-hidden="true">
            <div className="row row-nowrap">
              <Skeleton width={40} height={40} radius="50%" />
              <div className="grow">
                <Skeleton lines={2} />
              </div>
            </div>
            <Skeleton lines={3} />
          </div>
        ))}
        <span className="visually-hidden" role="status">
          Finding drivers
        </span>
      </div>
    );
  } else if (drivers.length === 0) {
    body = (
      <EmptyState icon="truck" title="No available drivers fit right now">
        <p>Drivers whose saved searches match get alerted, and new trucks come online all day. Check back soon.</p>
      </EmptyState>
    );
  } else {
    body = (
      <>
        <div className="grid-2">
          {shown!.map(({ driver, match }) => {
            const sent = invited.has(driver.userId);
            return (
              <DriverCard
                key={driver.userId}
                driver={driver}
                match={match}
                actions={
                  <>
                    <Button
                      variant="secondary"
                      icon={sent ? 'check' : 'send'}
                      disabled={sent}
                      onClick={() => onInvite(driver)}
                      aria-label={sent ? `Invite sent to ${driver.name}` : `Invite ${driver.name} to book`}
                    >
                      {sent ? 'Invited' : 'Invite to book'}
                    </Button>
                    <ButtonLink
                      to={paths.thread(load.id, driver.userId)}
                      variant="ghost"
                      icon="message"
                      aria-label={`Message ${driver.name}`}
                    >
                      Message
                    </ButtonLink>
                  </>
                }
              >
                <p className="text-sm strong">{shipperFitLine(match)}</p>
                {match.highlights.length ? (
                  <div className="row">
                    {match.highlights.slice(0, 3).map((h) => (
                      <Tag key={h} tone="ok" icon="star">
                        {h}
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </DriverCard>
            );
          })}
        </div>
        {drivers.length > RECOMMENDED_PREVIEW ? (
          <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'Show fewer drivers' : `Show all ${drivers.length} drivers`}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section className="stack-sm" aria-labelledby="recommended-title">
      <div className="stack-xs">
        <h2 id="recommended-title" className="section-title">
          Recommended drivers
        </h2>
        <p className="muted text-sm">Available drivers whose rigs fit this load, best match first.</p>
      </div>
      {body}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ShipperLoadDetailPage() {
  const { id = '' } = useParams();
  const user = useSignedInUser();
  const now = useNow();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const toast = useToast();

  const detail = useApi((signal) => api.loads.get(id, { signal }), [id]);
  const load = detail.data?.load;
  const isOpen = load?.status === 'open';
  const bookings = useApi((signal) => api.loads.bookings(id, { signal }), [id]);
  const recommended = useApi((signal) => api.loads.recommendedDrivers(id, { signal }), [id, isOpen], {
    enabled: isOpen && load?.shipperId === user.id,
  });

  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const { reload: reloadDetail } = detail;
  const { reload: reloadBookings } = bookings;
  const { reload: reloadRecommended } = recommended;
  const reloadAll = useCallback(() => {
    void reloadDetail();
    void reloadBookings();
    // Recommendations only exist while the load is open; once booked the section is gone.
    if (openRef.current) void reloadRecommended();
  }, [reloadDetail, reloadBookings, reloadRecommended]);

  useLiveReload(
    (event: ServerEvent) =>
      ((event.type === 'booking_updated' || event.type === 'load_updated') && event.loadId === id) ||
      notificationLoadId(event) === id ||
      event.type === 'hello',
    reloadAll,
  );
  const decisions = useRequestDecisions(reloadAll);

  // Dashboard links land on #requests; scroll there once the requests have rendered.
  const scrolledToHash = useRef(false);
  useEffect(() => {
    if (scrolledToHash.current || location.hash !== '#requests' || !bookings.data) return;
    scrolledToHash.current = true;
    requestAnimationFrame(scrollToRequests);
  }, [location.hash, bookings.data]);

  const [inviting, setInviting] = useState<DriverSummary | null>(null);
  const [invited, setInvited] = useState<Set<string>>(() => new Set());

  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useAction(() => api.loads.cancel(id));
  const onCancel = async () => {
    const result = await cancel.run();
    if (!result) return;
    setConfirmCancel(false);
    detail.setData((prev) => (prev ? { ...prev, load: { ...prev.load, ...result } } : prev));
    toast.success('Load cancelled', 'It’s off the board, and every driver involved has been told.');
    reloadAll();
  };

  if (!load) {
    if (detail.error) {
      return (
        <div className="stack sh-page">
          <PageHeader title="Load details" back={{ to: paths.shipperHome, label: 'Dashboard' }} />
          <ErrorState error={detail.error} title="We couldn’t open this load" onRetry={() => void detail.reload()} />
          <ButtonLink to={paths.shipperHome} variant="secondary" icon="arrowLeft" className="sh-self-start">
            Back to your loads
          </ButtonLink>
        </div>
      );
    }
    return <DetailSkeleton />;
  }

  if (load.shipperId !== user.id) {
    return (
      <div className="stack sh-page">
        <PageHeader title="Load details" back={{ to: paths.shipperHome, label: 'Dashboard' }} />
        <EmptyState icon="warning" title="This load belongs to another shipper" action={<ButtonLink to={paths.shipperHome}>Go to your dashboard</ButtonLink>}>
          <p>Only the shipper who posted a load can manage its requests.</p>
        </EmptyState>
      </div>
    );
  }

  const laneText = lane(load.origin, load.destination);
  const bookedDriver = detail.data?.bookedDriver ?? null;
  const acceptedBooking =
    bookings.data?.find((b) => b.status === 'accepted' && b.driverId === load.bookedDriverId) ?? null;
  const pendingCount = bookings.data
    ? bookings.data.filter((b) => b.status === 'pending').length
    : load.pendingRequestCount;
  const cancellable = load.status === 'open' || load.status === 'booked';

  const cancelMessage =
    load.status === 'booked'
      ? `${bookedDriver?.name ?? 'Your driver'} is booked on it and will be told right away. You can repost it later.`
      : pendingCount > 0
        ? `It comes off the board, and the ${plural(pendingCount, 'driver')} with requests will be told.`
        : 'It comes off the board right away. You can repost it later.';

  const timeline = (
    <Card as="section" title="Progress">
      <StatusTimeline load={load} bookedAt={acceptedBooking?.updatedAt ?? null} now={now} />
    </Card>
  );

  return (
    <div className="stack-lg sh-page">
      <PageHeader
        back={{ to: paths.shipperHome, label: 'Dashboard' }}
        eyebrow={`${load.referenceNumber ? `Ref ${load.referenceNumber} · ` : ''}Posted ${timeAgo(load.createdAt, now)}`}
        title={laneText}
        subtitle={`${load.commodity} · ${miles(load.miles)} · ${money(load.bookedRateUsd ?? load.rateUsd)}`}
        actions={
          <>
            {isOpen ? (
              <ButtonLink to={paths.shipperEditLoad(load.id)} variant="secondary" icon="edit">
                Edit
              </ButtonLink>
            ) : null}
            <ButtonLink to={paths.shipperRepost(load.id)} variant="secondary" icon="copy">
              Repost
            </ButtonLink>
          </>
        }
      />

      {isOpen && pendingCount > 0 ? (
        <InlineAlert
          tone="warn"
          title={`${plural(pendingCount, 'driver')} ${pendingCount === 1 ? 'wants' : 'want'} this load`}
          action={
            <Button size="sm" icon="users" onClick={scrollToRequests}>
              Review requests
            </Button>
          }
        >
          {pendingCount === 1
            ? 'Accept to book it, or invite one of the recommended drivers below.'
            : 'Accept one to book it. The others are declined for you.'}
        </InlineAlert>
      ) : null}

      <div className="layout-sidebar">
        <div className="stack-lg">
          <LoadSummary load={load} now={now} mapHeight={isDesktop ? 280 : 200} />
          {isDesktop ? null : timeline}
          {bookedDriver && load.status !== 'open' && load.status !== 'cancelled' ? (
            <BookedDriver load={load} driver={bookedDriver} booking={acceptedBooking} now={now} />
          ) : null}
          <RequestsSection
            load={load}
            bookings={bookings.data}
            error={bookings.error}
            onRetry={() => void bookings.reload()}
            decisions={decisions}
            now={now}
          />
          {isOpen ? (
            <RecommendedSection
              load={load}
              drivers={recommended.data}
              error={recommended.error}
              onRetry={() => void recommended.reload()}
              invited={invited}
              onInvite={setInviting}
            />
          ) : null}
        </div>

        <aside className="stack-lg sticky-panel" aria-label="Load status">
          {isDesktop ? timeline : null}
          {cancellable ? (
            <Card as="section" title="Need to pull it?" muted>
              <div className="stack-sm">
                <p className="text-sm muted">
                  Cancelling takes it off the board and tells every driver with a request or booking.
                </p>
                <Button variant="danger" icon="x" onClick={() => setConfirmCancel(true)}>
                  Cancel load
                </Button>
              </div>
            </Card>
          ) : null}
        </aside>
      </div>

      {decisions.dialog}

      <InviteDialog
        loadId={load.id}
        driver={inviting}
        onClose={() => setInviting(null)}
        onInvited={(driverId) => setInvited((prev) => new Set(prev).add(driverId))}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this load?"
        message={cancelMessage}
        confirmLabel="Cancel load"
        cancelLabel="Keep it"
        tone="danger"
        pending={cancel.pending}
        onConfirm={() => void onCancel()}
        onCancel={() => {
          setConfirmCancel(false);
          cancel.reset();
        }}
      >
        {cancel.error ? (
          <InlineAlert tone="bad" title="Couldn’t cancel">
            {errorMessage(cancel.error)}
          </InlineAlert>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
