import { useState } from 'react';
import { Link } from 'react-router';
import type { DriverProfile, DriverStats, User } from '../../../../shared/types';
import { Badge } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { Avatar, DetailList, StatGrid, StatTile } from '../../components/DataDisplay';
import { ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { useAuth, useSignedInUser } from '../../lib/auth';
import { driverClassLabel, equipmentList, feet, lbs, money, number, place, plural } from '../../lib/format';
import { useApi, type AsyncState } from '../../lib/hooks';
import { paths } from '../../lib/routes';
import { DetailsCard, PasswordCard } from './components/AccountForms';
import './components/common.css';

const memberSince = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

export default function AccountPage() {
  const user = useSignedInUser();
  const { driverProfile } = useAuth();
  return (
    <div className="stack-lg">
      <PageHeader title="Account" subtitle="Your contact details, password and sign-in." />
      <div className="cm-account">
        <div className="cm-account__aside stack-lg">
          <IdentityCard user={user} profile={driverProfile} />
          {user.role === 'driver' ? <RigCard profile={driverProfile} /> : <ShipperLoadsCard />}
        </div>
        <div className="stack-lg">
          <DetailsCard key={user.id} user={user} />
          <PasswordCard email={user.email} />
          <SignOutCard email={user.email} />
        </div>
      </div>
    </div>
  );
}

function IdentityCard({ user, profile }: { user: User; profile: DriverProfile | null }) {
  const roleLabel = user.role === 'driver' ? (profile ? `${driverClassLabel(profile.driverClass)} driver` : 'Driver') : 'Shipper';
  return (
    <Card>
      <div className="cm-identity">
        <Avatar name={user.name} size="lg" />
        <div className="cm-identity__text">
          <h2 className="cm-identity__name">{user.name}</h2>
          {user.company ? <p className="cm-identity__line">{user.company}</p> : null}
          <p className="cm-identity__line">{user.email}</p>
          <div className="row">
            <Badge tone="brand" icon={user.role === 'driver' ? 'truck' : 'building'}>
              {roleLabel}
            </Badge>
            <span className="muted text-sm">Member since {memberSince.format(new Date(user.createdAt))}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Driver: rig summary, stats and links to the rig profile and alerts
// ---------------------------------------------------------------------------

function RigCard({ profile }: { profile: DriverProfile | null }) {
  const stats = useApi((signal) => api.drivers.myStats({ signal }), []);
  const complete = profile?.profileComplete ?? false;
  return (
    <Card as="section" title="Your rig" subtitle={profile?.truckDescription || (profile ? driverClassLabel(profile.driverClass) : undefined)}>
      <div className="stack">
        {!complete ? (
          <InlineAlert
            tone="warn"
            title="Finish setting up your rig"
            action={
              <ButtonLink to={paths.driverSetup} size="sm">
                Finish setup
              </ButtonLink>
            }
          >
            Add your equipment, capacity and where you’re empty so we can match you to loads.
          </InlineAlert>
        ) : null}

        {profile ? (
          <DetailList
            items={[
              { label: 'Equipment', value: profile.equipmentTypes.length ? equipmentList(profile.equipmentTypes) : 'Not set yet' },
              { label: 'Trailer', value: feet(profile.trailerLengthFt) },
              { label: 'Max payload', value: lbs(profile.maxPayloadLbs) },
              { label: 'Empty in', value: place(profile.currentLocation) },
              { label: 'Status', value: profile.available ? 'Taking loads' : 'Not taking loads' },
            ]}
          />
        ) : null}

        {complete ? <DriverStatsTiles stats={stats} /> : null}

        <nav className="cm-links" aria-label="Driver settings">
          <SettingsLink to={paths.driverProfile} icon="truck" title="Rig & preferences" hint="Equipment, capacity, deadhead and $/mi floor" />
          <SettingsLink to={paths.driverAlerts} icon="siren" title="Load alerts" hint="Saved searches that ping you" />
        </nav>
      </div>
    </Card>
  );
}

function DriverStatsTiles({ stats }: { stats: AsyncState<DriverStats> }) {
  if (stats.error && !stats.data) {
    return <ErrorState compact error={stats.error} title="Couldn’t load your numbers" onRetry={() => void stats.reload()} />;
  }
  if (!stats.data) return <StatsSkeleton />;
  const { activeLoads, completedLoads, earnedUsd, pendingRequests } = stats.data;
  return (
    <StatGrid>
      <StatTile
        label="Active loads"
        value={number(activeLoads)}
        hint={pendingRequests > 0 ? `${plural(pendingRequests, 'request')} waiting` : 'Booked or rolling'}
        icon="route"
        to={paths.driverTrips}
      />
      <StatTile label="Delivered" value={number(completedLoads)} hint={`${money(earnedUsd)} earned`} icon="check" tone="ok" />
    </StatGrid>
  );
}

// ---------------------------------------------------------------------------
// Shipper: load counts and links to the dashboard
// ---------------------------------------------------------------------------

function ShipperLoadsCard() {
  const stats = useApi((signal) => api.shipper.stats({ signal }), []);
  return (
    <Card as="section" title="Your loads">
      <div className="stack">
        {stats.error && !stats.data ? (
          <ErrorState compact error={stats.error} title="Couldn’t load your numbers" onRetry={() => void stats.reload()} />
        ) : !stats.data ? (
          <StatsSkeleton />
        ) : (
          <StatGrid>
            <StatTile
              label="Open"
              value={number(stats.data.open)}
              hint={stats.data.expired > 0 ? `${number(stats.data.expired)} past pickup: edit or cancel` : 'Waiting on a driver'}
              icon="boxes"
              tone={stats.data.expired > 0 ? 'warn' : 'brand'}
              to={paths.shipperHome}
            />
            <StatTile
              label="Requests"
              value={number(stats.data.pendingRequests)}
              hint={stats.data.pendingRequests > 0 ? 'Waiting on you' : 'Nothing to review'}
              icon="users"
              tone={stats.data.pendingRequests > 0 ? 'warn' : 'neutral'}
              to={paths.shipperHome}
            />
          </StatGrid>
        )}
        <nav className="cm-links" aria-label="Shipper shortcuts">
          <SettingsLink to={paths.shipperHome} icon="grid" title="Dashboard" hint="Your loads, requests and drivers" />
          <SettingsLink to={paths.shipperNewLoad} icon="plusSquare" title="Post a load" hint="Get it in front of matched drivers" />
        </nav>
      </div>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="stat-grid" aria-busy="true" aria-label="Loading your numbers" role="status">
      <Skeleton height={92} radius="12px" />
      <Skeleton height={92} radius="12px" />
    </div>
  );
}

function SettingsLink({ to, icon, title, hint }: { to: string; icon: IconName; title: string; hint: string }) {
  return (
    <Link to={to} className="cm-link">
      <span className="cm-link__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="cm-link__text">
        <span className="cm-link__title">{title}</span>
        <span className="cm-link__hint">{hint}</span>
      </span>
      <Icon name="chevronRight" size={20} className="cm-link__chevron" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

function SignOutCard({ email }: { email: string }) {
  const { logout } = useAuth();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  // Once the user is cleared, RequireRole sends the page to "/" (see AuthContextValue.signedOut).
  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // logout() clears the session locally even when the request fails; say so.
      toast.info('Signed out on this device', 'We couldn’t reach HaulMatch to end the session everywhere.');
    }
  };

  return (
    <Card as="section" title="Sign out" subtitle={`Signed in as ${email} on this device.`}>
      <Button variant="secondary" icon="logout" onClick={() => void signOut()} loading={signingOut}>
        Sign out
      </Button>
    </Card>
  );
}
