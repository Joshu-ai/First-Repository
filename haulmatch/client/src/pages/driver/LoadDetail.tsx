import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { driveHours } from '../../../../shared/geo';
import type { Booking, LoadDetailResponse, LoadWithMatch } from '../../../../shared/types';
import { Badge, StatusBadge, Tag } from '../../components/Badge';
import { Button, ButtonAnchor, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { DetailList, type DetailItem } from '../../components/DataDisplay';
import { EquipmentChips } from '../../components/Equipment';
import { ErrorState, InlineAlert, LoadListSkeleton, Skeleton } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LoadCard } from '../../components/LoadCard';
import { MatchBreakdownBars, MatchChecks, ProfitSummary } from '../../components/MatchDetails';
import { PageHeader } from '../../components/PageHeader';
import { RouteMap, type MapPin } from '../../components/RouteMap';
import { ScoreBadge } from '../../components/ScoreBadge';
import { useToast } from '../../components/Toast';
import { api, isApiError } from '../../lib/api';
import { useAuth, useSignedInUser } from '../../lib/auth';
import { filtersToQueryString } from '../../lib/filters';
import {
  bookingStatusLabel,
  feet,
  lane,
  lbs,
  miles,
  money,
  pickupTime,
  place,
  ratePerMile,
  relativeHours,
  scoreLabel,
  timeAgo,
  timeWindow,
} from '../../lib/format';
import { useApi, useIsDesktop, useNow } from '../../lib/hooks';
import { useServerEvent } from '../../lib/realtime';
import { paths } from '../../lib/routes';
import { lastBoardPath } from './components/boardMemory';
import { BookDialog } from './components/BookDialog';
import { TripStatusButton, WithdrawButton } from './components/TripActions';
import { useCoalesced, useRefreshOnFocus } from './components/useRefreshOnFocus';
import './components/driver.css';

/** What the driver can do with this load right now. */
type Situation = 'booked' | 'in_transit' | 'delivered' | 'pending' | 'open' | 'ineligible' | 'setup' | 'closed';

function situationOf(load: LoadWithMatch, myBooking: Booking | null, userId: string): Situation {
  const mine = load.bookedDriverId === userId;
  if (mine && load.status === 'booked') return 'booked';
  if (mine && load.status === 'in_transit') return 'in_transit';
  if (mine && load.status === 'delivered') return 'delivered';
  if (load.status !== 'open') return 'closed';
  if (myBooking?.status === 'pending') return 'pending';
  if (!load.match) return 'setup';
  return load.match.eligible ? 'open' : 'ineligible';
}

const BACKHAUL_RADIUS_MILES = 150;

export default function DriverLoadDetailPage() {
  const { id = '' } = useParams();
  const detail = useApi((signal) => api.loads.get(id, { signal }), [id]);
  const backTo = useMemo(() => lastBoardPath(), []);

  const reloadSoon = useCoalesced(() => void detail.reload());
  useServerEvent((e) => {
    if ((e.type === 'load_updated' || e.type === 'booking_updated') && e.loadId === id) reloadSoon();
  });
  useRefreshOnFocus(() => void detail.reload());

  if (!detail.data) {
    if (detail.error) {
      const gone = isApiError(detail.error) && detail.error.status === 404;
      return (
        <div className="stack-lg">
          <PageHeader back={{ to: backTo, label: 'Load board' }} title="Load details" />
          <ErrorState
            error={detail.error}
            title={gone ? 'This load isn’t on the board anymore' : 'Couldn’t load this load'}
            onRetry={() => void detail.reload()}
          />
          {gone ? (
            <div className="row row-center">
              <ButtonLink to={backTo} icon="arrowLeft">
                Back to the load board
              </ButtonLink>
            </div>
          ) : null}
        </div>
      );
    }
    return <DetailSkeleton backTo={backTo} />;
  }

  return <LoadDetailView key={id} data={detail.data} reload={() => void detail.reload()} backTo={backTo} />;
}

function DetailSkeleton({ backTo }: { backTo: string }) {
  return (
    <div className="stack-lg" aria-busy="true">
      <PageHeader back={{ to: backTo, label: 'Load board' }} title="Load details" />
      <div className="card" role="status" aria-label="Loading load details">
        <div className="drv-hero">
          <Skeleton width={88} height={88} radius="50%" />
          <div className="drv-hero__facts">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} lines={2} />
            ))}
          </div>
        </div>
      </div>
      <Skeleton height={240} radius="12px" />
      <div className="card">
        <Skeleton lines={5} />
      </div>
    </div>
  );
}

function LoadDetailView({ data, reload, backTo }: { data: LoadDetailResponse; reload: () => void; backTo: string }) {
  const user = useSignedInUser();
  const { driverProfile } = useAuth();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const [bookOpen, setBookOpen] = useState(false);
  const { load, myBooking } = data;
  const match = load.match;
  const situation = situationOf(load, myBooking, user.id);
  const backhauls = useApi((signal) => api.loads.backhauls(load.id, { signal }), [load.id]);

  const onMyTruck = situation === 'booked' || situation === 'in_transit' || situation === 'delivered';
  const rate = onMyTruck ? (load.bookedRateUsd ?? load.rateUsd) : load.rateUsd;
  const offer = situation === 'pending' ? myBooking?.offerRateUsd ?? null : onMyTruck && rate !== load.rateUsd ? rate : null;
  const showTruck = !onMyTruck && situation !== 'closed';
  const extraPins: MapPin[] = useMemo(
    () => (driverProfile?.homeBase ? [{ ...driverProfile.homeBase, label: `Home: ${place(driverProfile.homeBase)}`, kind: 'home' }] : []),
    [driverProfile?.homeBase],
  );

  const actions = (
    <ActionButtons
      situation={situation}
      data={data}
      userId={user.id}
      onBook={() => setBookOpen(true)}
      onChanged={reload}
      block={isDesktop}
    />
  );

  const headerBadges = (
    <>
      {load.status !== 'open' ? <StatusBadge kind="load" status={load.status} /> : null}
      {myBooking && !onMyTruck ? <StatusBadge kind="booking" status={myBooking.status} /> : null}
      {load.bookingMode === 'instant' && load.status === 'open' ? (
        <Badge tone="brand" icon="bolt">
          Instant book
        </Badge>
      ) : null}
    </>
  );

  return (
    <div className="stack-lg">
      <PageHeader
        back={{ to: backTo, label: 'Load board' }}
        eyebrow={load.commodity}
        title={lane(load.origin, load.destination)}
        subtitle={`${miles(load.miles)} · Pickup ${pickupTime(load.pickupStart, now)} (${relativeHours(load.pickupStart, now)})`}
        actions={headerBadges}
      />

      <Card className="drv-hero" aria-label="Load summary">
        {match && load.status === 'open' ? <ScoreBadge score={match.score} eligible={match.eligible} size="lg" /> : null}
        <dl className="drv-hero__facts">
          <div>
            <dt>{onMyTruck ? 'Your rate' : 'Posted'}</dt>
            <dd>{money(rate)}</dd>
            <dd className="drv-hero__sub">{ratePerMile(rate / Math.max(1, load.miles))} loaded</dd>
          </div>
          <div>
            <dt>Deadhead</dt>
            <dd>{match?.deadheadMiles == null ? '—' : miles(match.deadheadMiles)}</dd>
            <dd className="drv-hero__sub">
              {match?.deadheadMiles == null
                ? 'Set your location'
                : driverProfile?.currentLocation
                  ? `from ${driverProfile.currentLocation.city}`
                  : 'to pickup'}
            </dd>
          </div>
          <div>
            <dt>All-in</dt>
            <dd>{match ? ratePerMile(rate / Math.max(1, match.totalMiles)) : '—'}</dd>
            <dd className="drv-hero__sub">{match ? `${miles(match.totalMiles)} total` : 'with deadhead'}</dd>
          </div>
          <div>
            <dt>Est. profit</dt>
            <dd className={match && rate - match.fuelCostUsd < 0 ? 'text-bad' : undefined}>
              {match ? money(rate - match.fuelCostUsd) : '—'}
            </dd>
            <dd className="drv-hero__sub">{match ? `after ${money(match.fuelCostUsd)} fuel` : 'after fuel'}</dd>
          </div>
        </dl>
      </Card>

      {!isDesktop ? <SituationNotice situation={situation} data={data} now={now} onChanged={reload} /> : null}

      <div className="layout-sidebar">
        <div className="stack-lg">
          <RouteMap
            origin={load.origin}
            destination={load.destination}
            driverLocation={showTruck ? driverProfile?.currentLocation : null}
            extraPins={extraPins}
            height={isDesktop ? 300 : 220}
          />
          <ScheduleCard load={load} now={now} />
          <FreightCard load={load} />
          <ShipperCard data={data} onMyTruck={onMyTruck} userId={user.id} now={now} />
        </div>

        <aside className="stack-lg" aria-label="Match and money">
          {isDesktop ? (
            <Card as="section" title="Your move">
              <div className="stack">
                <SituationNotice situation={situation} data={data} now={now} onChanged={reload} />
                {actions}
              </div>
            </Card>
          ) : null}
          {/* Once a load is off the board the matcher only reports "already booked"; the fit no longer matters. */}
          {load.status === 'open' ? <MatchCard load={load} /> : null}
          <Card as="section" title="The money" subtitle="Estimates, before tolls and other costs.">
            <div className="stack">
              <ProfitSummary load={load} match={match} offerRateUsd={offer} />
              {driverProfile ? (
                <p className="drv-fuel-note">
                  <Icon name="fuel" size={16} />
                  <span>
                    Fuel uses your {driverProfile.mpg} mpg and {money(driverProfile.fuelPricePerGallon, { cents: true })}/gal.{' '}
                    <Link to={paths.driverProfile}>Change</Link>
                  </span>
                </p>
              ) : null}
            </div>
          </Card>
        </aside>
      </div>

      <BackhaulSection load={load} state={backhauls} now={now} initialCount={isDesktop ? 6 : 3} />

      {!isDesktop ? <div className="action-bar">{actions}</div> : null}

      <BookDialog
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        load={load}
        onStale={reload}
        onBooked={(result) => {
          const booked = result.booking.status === 'accepted';
          toast.show({
            tone: 'success',
            title: booked ? 'Booked. It’s yours!' : 'Request sent',
            body: booked
              ? `${lane(load.origin, load.destination)}. Pick up ${pickupTime(load.pickupStart)}.`
              : `${load.shipperCompany ?? load.shipperName} will accept or decline. We’ll let you know.`,
            link: { to: paths.driverTrips, label: 'My trips' },
          });
          reload();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Situation: what is going on with this load for me, and the buttons for it
// ---------------------------------------------------------------------------

function SituationNotice({
  situation,
  data,
  now,
  onChanged,
}: {
  situation: Situation;
  data: LoadDetailResponse;
  now: Date;
  onChanged: () => void;
}) {
  const { load, myBooking } = data;
  const shipper = load.shipperCompany ?? load.shipperName;
  const rate = load.bookedRateUsd ?? load.rateUsd;

  switch (situation) {
    case 'booked':
      return (
        <InlineAlert
          tone="ok"
          title="You’re booked on this load"
          action={
            myBooking ? (
              <WithdrawButton booking={myBooking} load={load} onDone={onChanged} variant="ghost" size="sm" />
            ) : undefined
          }
        >
          Pick up in {place(load.origin)}, {timeWindow(load.pickupStart, load.pickupEnd, now)}. Rate {money(rate)}. Tap
          “Picked up” once it’s loaded.
        </InlineAlert>
      );
    case 'in_transit':
      return (
        <InlineAlert tone="info" title="On your truck">
          {load.pickedUpAt ? `Picked up ${timeAgo(load.pickedUpAt, now)}. ` : ''}Deliver to {place(load.destination)}
          {load.deliveryBy ? ` by ${pickupTime(load.deliveryBy, now)}` : ''}. Tap “Delivered” once it’s signed for.
        </InlineAlert>
      );
    case 'delivered':
      return (
        <InlineAlert tone="ok" title="Delivered">
          {load.deliveredAt ? `Delivered ${pickupTime(load.deliveredAt, now)}` : 'Delivered'} for {money(rate)}. Check the
          backhauls below for your next run.
        </InlineAlert>
      );
    case 'pending':
      return (
        <InlineAlert tone="info" title="Request sent">
          Sent {myBooking ? timeAgo(myBooking.createdAt, now) : 'recently'}
          {myBooking?.offerRateUsd ? ` with your offer of ${money(myBooking.offerRateUsd)}` : ' at the posted rate'}. {shipper}{' '}
          will accept or decline, and we’ll notify you.
        </InlineAlert>
      );
    case 'ineligible': {
      const failed = load.match?.checks.filter((c) => c.hard && !c.ok) ?? [];
      return (
        <InlineAlert
          tone="warn"
          title="This load doesn’t fit your rig"
          action={
            <ButtonLink to={paths.driverProfile} variant="secondary" size="sm">
              Update rig
            </ButtonLink>
          }
        >
          <ul className="drv-failed">
            {failed.map((c) => (
              <li key={c.key}>{c.label}</li>
            ))}
          </ul>
          <p>You can still message the shipper if you think it could work.</p>
        </InlineAlert>
      );
    }
    case 'setup':
      return (
        <InlineAlert tone="warn" title="Finish your rig setup to book">
          We need your equipment, capacity and location to check this load fits.
        </InlineAlert>
      );
    case 'closed':
      return (
        <InlineAlert tone="info" title={load.status === 'cancelled' ? 'The shipper cancelled this load' : 'Another driver has this load'}>
          {myBooking ? `Your request: ${bookingStatusLabel(myBooking.status).toLowerCase()}. ` : ''}Plenty more on the board.
        </InlineAlert>
      );
    case 'open':
      return myBooking && myBooking.status !== 'pending' ? (
        <InlineAlert tone="info" title={`Your last request was ${bookingStatusLabel(myBooking.status).toLowerCase()}`}>
          The load is still open, so you can send a new one.
        </InlineAlert>
      ) : null;
  }
}

function ActionButtons({
  situation,
  data,
  userId,
  onBook,
  onChanged,
  block,
}: {
  situation: Situation;
  data: LoadDetailResponse;
  userId: string;
  onBook: () => void;
  onChanged: () => void;
  block: boolean;
}) {
  const { load, myBooking } = data;
  const message = (variant: 'primary' | 'secondary') => (
    <ButtonLink to={paths.thread(load.id, userId)} variant={variant} size="lg" icon="message" block={block}>
      Message shipper
    </ButtonLink>
  );
  const wrap = (children: ReactNode) => (block ? <div className="drv-actions">{children}</div> : <>{children}</>);

  switch (situation) {
    case 'booked':
    case 'in_transit':
      return wrap(
        <>
          <TripStatusButton load={load} onDone={onChanged} size="lg" block={block} />
          {message('secondary')}
        </>,
      );
    case 'delivered':
      return wrap(
        <>
          <Button
            size="lg"
            icon="route"
            block={block}
            onClick={() => document.getElementById('backhauls')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Find a backhaul
          </Button>
          {message('secondary')}
        </>,
      );
    case 'pending':
      return wrap(
        <>
          {message('primary')}
          {myBooking ? <WithdrawButton booking={myBooking} load={load} onDone={onChanged} size="lg" block={block} /> : null}
        </>,
      );
    case 'open':
      return wrap(
        <>
          <Button size="lg" icon={load.bookingMode === 'instant' ? 'bolt' : 'send'} onClick={onBook} block={block}>
            {load.bookingMode === 'instant' ? 'Book now' : 'Request load'}
          </Button>
          {message('secondary')}
        </>,
      );
    case 'ineligible':
      return wrap(message('primary'));
    case 'setup':
      return wrap(
        <>
          <ButtonLink to={paths.driverSetup} size="lg" iconAfter="arrowRight" block={block}>
            Finish setup
          </ButtonLink>
          {message('secondary')}
        </>,
      );
    case 'closed':
      return wrap(
        <>
          <ButtonLink to={paths.driverLoads} size="lg" icon="boxes" block={block}>
            Find another load
          </ButtonLink>
          {message('secondary')}
        </>,
      );
  }
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function ScheduleCard({ load, now }: { load: LoadWithMatch; now: Date }) {
  const hours = Math.max(1, Math.round(driveHours(load.miles)));
  const items: DetailItem[] = [
    { label: 'Pickup', value: place(load.origin), strong: true },
    { label: 'Pickup window', value: timeWindow(load.pickupStart, load.pickupEnd, now) },
    { label: 'Delivery', value: place(load.destination), strong: true },
    { label: 'Deliver by', value: load.deliveryBy ? pickupTime(load.deliveryBy, now) : 'Not set, ask the shipper' },
    { label: 'Loaded miles', value: `${miles(load.miles)} · about ${hours}h driving` },
  ];
  if (load.pickedUpAt) items.push({ label: 'Picked up', value: pickupTime(load.pickedUpAt, now) });
  if (load.deliveredAt) items.push({ label: 'Delivered', value: pickupTime(load.deliveredAt, now) });
  return (
    <Card as="section" title="Pickup and delivery">
      <DetailList items={items} />
    </Card>
  );
}

function FreightCard({ load }: { load: LoadWithMatch }) {
  const flags: ReactNode[] = [];
  if (load.hazmat) flags.push(<Badge key="hazmat" tone="bad" icon="hazard">Hazmat</Badge>);
  if (load.tarpRequired) flags.push(<Badge key="tarp" tone="warn" icon="tarp">Tarp required</Badge>);
  if (load.teamRequired) flags.push(<Badge key="team" tone="info" icon="users">Team required</Badge>);
  if (load.loadSize === 'partial') flags.push(<Badge key="partial">Partial (LTL)</Badge>);
  return (
    <Card as="section" title="Freight">
      <div className="stack">
        <div className="stack-xs">
          <p className="text-sm muted">Equipment the shipper accepts</p>
          <EquipmentChips codes={load.equipmentTypes} matched={load.match?.matchedEquipment} long />
        </div>
        <DetailList
          items={[
            { label: 'Commodity', value: load.commodity },
            { label: 'Weight', value: lbs(load.weightLbs) },
            { label: 'Length', value: feet(load.lengthFt) },
            { label: 'Load size', value: load.loadSize === 'partial' ? 'Partial, shares the deck' : 'Full load' },
          ]}
        />
        {flags.length ? <div className="drv-flags">{flags}</div> : null}
        {load.notes ? (
          <div className="stack-xs">
            <p className="text-sm strong">Shipper notes</p>
            <p className="drv-notes">{load.notes}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function ShipperCard({ data, onMyTruck, userId, now }: { data: LoadDetailResponse; onMyTruck: boolean; userId: string; now: Date }) {
  const { load } = data;
  const items: DetailItem[] = [
    { label: 'Company', value: load.shipperCompany ?? 'Independent shipper' },
    { label: onMyTruck ? 'Your contact' : 'Posted by', value: load.shipperName },
  ];
  // Only sent to the driver booked on the load.
  if (data.shipperPhone) {
    items.push({ label: 'Phone', value: <a href={`tel:${data.shipperPhone}`}>{data.shipperPhone}</a> });
  }
  if (load.referenceNumber) items.push({ label: 'Reference', value: load.referenceNumber });
  items.push({ label: 'Posted', value: timeAgo(load.createdAt, now) });
  return (
    <Card
      as="section"
      title="Shipper"
      actions={
        <div className="row">
          {data.shipperPhone ? (
            <ButtonAnchor href={`tel:${data.shipperPhone}`} variant="ghost" size="sm" icon="phone">
              Call
            </ButtonAnchor>
          ) : null}
          <ButtonLink to={paths.thread(load.id, userId)} variant="ghost" size="sm" icon="message">
            Message
          </ButtonLink>
        </div>
      }
    >
      <div className="stack">
        <DetailList items={items} />
        {onMyTruck ? (
          <p className="muted text-sm">
            Call or message for pickup times, dock details and paperwork. The shipper has your phone number too.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function MatchCard({ load }: { load: LoadWithMatch }) {
  const match = load.match;
  if (!match) {
    return (
      <Card as="section" title="How it fits your rig">
        <p className="muted">Finish your rig setup to see the match score and checks.</p>
      </Card>
    );
  }
  return (
    <Card as="section" title="How it fits your rig" subtitle={match.eligible ? `${scoreLabel(match.score)} · ${match.score} of 100` : 'Not a fit for your rig'}>
      <div className="stack">
        {match.highlights.length ? (
          <div className="row" aria-label="Highlights">
            {match.highlights.map((h) => (
              <Tag key={h} tone="ok" icon="star">
                {h}
              </Tag>
            ))}
          </div>
        ) : null}
        <MatchChecks checks={match.checks} />
        {match.eligible ? (
          <div className="stack-sm">
            <h3 className="text-sm strong">What drives the score</h3>
            <MatchBreakdownBars breakdown={match.breakdown} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Backhauls
// ---------------------------------------------------------------------------

function BackhaulSection({
  load,
  state,
  now,
  initialCount,
}: {
  load: LoadWithMatch;
  state: { data: LoadWithMatch[] | undefined; error: unknown; loading: boolean; reload: () => Promise<void> };
  now: Date;
  /** Cards shown before "Show all", so a phone is not ten cards long. */
  initialCount: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = state.data ?? [];
  const shown = showAll ? list : list.slice(0, initialCount);
  const boardLink = `${paths.driverLoads}?${filtersToQueryString({
    originCityId: load.destination.cityId,
    originRadiusMiles: BACKHAUL_RADIUS_MILES,
    includeIneligible: true,
  })}`;
  return (
    <section id="backhauls" className="stack" aria-labelledby="backhauls-title">
      <div className="row row-between">
        <div className="stack-xs">
          <h2 id="backhauls-title" className="section-title">
            Backhauls from {place(load.destination)}
          </h2>
          <p className="muted text-sm">
            Loads picking up within {BACKHAUL_RADIUS_MILES} mi after you deliver, matched as if you’re empty there.
          </p>
        </div>
        <ButtonLink to={boardLink} variant="ghost" iconAfter="arrowRight">
          See all nearby
        </ButtonLink>
      </div>
      {state.loading && !state.data ? (
        <LoadListSkeleton count={2} label="Loading backhauls" />
      ) : state.error && !state.data ? (
        <ErrorState compact error={state.error} title="Couldn’t load backhauls" onRetry={() => void state.reload()} />
      ) : !state.data?.length ? (
        <div className="card card--muted">
          <p className="muted">
            Nothing posted near {load.destination.city} that fits your rig yet. Save an alert from the load board and
            we’ll ping you.
          </p>
        </div>
      ) : (
        <>
          <ul className="list-reset grid-auto">
            {shown.map((b) => (
              <li key={b.id}>
                <LoadCard load={b} match={b.match} href={paths.driverLoad(b.id)} now={now} />
              </li>
            ))}
          </ul>
          {shown.length < list.length ? (
            <Button variant="secondary" block icon="chevronDown" onClick={() => setShowAll(true)}>
              Show all {list.length} backhauls
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

