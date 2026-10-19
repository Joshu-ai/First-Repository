import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import type { DriverClass, DriverProfile, User } from '../../../../shared/types';
import { Badge, Chip } from '../../components/Badge';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/DataDisplay';
import { ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useAuth, useSignedInUser } from '../../lib/auth';
import { driverClassLabel, equipmentList, place, plural, rating } from '../../lib/format';
import { useApi } from '../../lib/hooks';
import { pinnedBarRef } from '../../lib/pinnedBar';
import { paths } from '../../lib/routes';
import {
  CapacitySection,
  EquipmentSection,
  LocationSection,
  PreferencesSection,
  RigTypeSection,
} from './components/ProfileSections';
import {
  changeDriverClass,
  draftFromProfile,
  errorsFromApi,
  fullUpdate,
  hasErrors,
  sameDraft,
  validateAll,
  type ProfileDraft,
  type ProfileErrors,
  type SectionId,
} from './components/profileForm';
import './components/driver.css';

const SECTIONS: { id: SectionId; title: string; subtitle: string }[] = [
  { id: 'rig', title: 'Rig type', subtitle: 'Hotshot or semi.' },
  { id: 'equipment', title: 'Equipment', subtitle: 'Every trailer setup you can pull.' },
  { id: 'capacity', title: 'Capacity and license', subtitle: 'What you can legally haul.' },
  { id: 'location', title: 'Location and availability', subtitle: 'Deadhead and timing start here.' },
  { id: 'preferences', title: 'Preferences', subtitle: 'Deadhead, rate, states and fuel.' },
];

const sectionDomId = (id: SectionId) => `profile-${id}`;

export default function DriverProfilePage() {
  const { driverProfile, setDriverProfile } = useAuth();
  const fresh = useApi((signal) => api.drivers.myProfile({ signal }), []);

  // Keep the signed-in copy current (rating and completed loads change as trips finish).
  useEffect(() => {
    if (fresh.data) setDriverProfile(fresh.data);
  }, [fresh.data, setDriverProfile]);

  // Edit the freshest copy; fall back to the session's copy if the refresh failed.
  const profile = fresh.data ?? (fresh.error ? driverProfile : null);

  return (
    <div className="container container--narrow">
      <PageHeader
        title="Rig & preferences"
        subtitle="Everything we use to match you with loads."
        actions={
          <ButtonLink to={paths.account} variant="ghost" icon="user">
            Account settings
          </ButtonLink>
        }
      />
      {profile ? (
        <ProfileEditor key={profile.userId} profile={profile} />
      ) : fresh.error ? (
        <ErrorState error={fresh.error} title="Couldn’t load your rig profile" onRetry={() => void fresh.reload()} />
      ) : (
        <div className="stack-lg" aria-busy="true" role="status" aria-label="Loading your rig profile">
          <div className="card">
            <Skeleton width="50%" height={18} />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card stack">
              <Skeleton width="35%" height={18} />
              <Skeleton height={64} radius="12px" />
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({ profile }: { profile: DriverProfile }) {
  const user = useSignedInUser();
  const { setDriverProfile } = useAuth();
  const toast = useToast();
  const [baseline, setBaseline] = useState(profile);
  const original = useMemo(() => draftFromProfile(baseline), [baseline]);
  const [draft, setDraft] = useState<ProfileDraft>(original);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = !sameDraft(draft, original);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !saving && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const clearErrors = (keys: string[]) => {
    if (keys.some((k) => k in errors)) {
      setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))) as ProfileErrors);
    }
  };

  const update = (patch: Partial<ProfileDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    const keys = Object.keys(patch).map((k) => (k === 'currentCity' ? 'currentCityId' : k === 'homeCity' ? 'homeCityId' : k));
    if (patch.availability) keys.push('available', 'availableFrom');
    clearErrors(keys);
  };

  const changeClass = (next: DriverClass) => {
    setDraft((prev) => changeDriverClass(prev, next));
    clearErrors(['driverClass', 'equipmentTypes']);
  };

  const focusFirstError = () =>
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.field--invalid input:not([disabled]), [aria-invalid="true"]')?.focus();
    });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateAll(draft);
    setErrors(found);
    setFormError(null);
    if (hasErrors(found)) {
      focusFirstError();
      return;
    }
    setSaving(true);
    try {
      const saved = await api.drivers.updateMyProfile(fullUpdate(draft));
      setDriverProfile(saved);
      setBaseline(saved);
      setDraft(draftFromProfile(saved));
      setErrors({});
      toast.success('Rig and preferences saved', 'Match scores and profit estimates now use the new details.');
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? errorsFromApi(err) : {};
      if (hasErrors(fieldErrors)) {
        setErrors(fieldErrors);
        focusFirstError();
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  /** Discard sits next to Save and throws away every edit at once, so it asks first. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discard = () => {
    setConfirmDiscard(false);
    setDraft(original);
    setErrors({});
    setFormError(null);
  };

  const classChanged = draft.driverClass !== baseline.driverClass && baseline.equipmentTypes.length > 0;
  const sectionBody: Record<SectionId, ReactNode> = {
    rig: (
      <div className="stack">
        <RigTypeSection draft={draft} onClassChange={changeClass} errors={errors} />
        {classChanged ? (
          <InlineAlert tone="warn" title={`Switching to ${driverClassLabel(draft.driverClass).toLowerCase()}`}>
            Your {driverClassLabel(baseline.driverClass).toLowerCase()} equipment was cleared. Pick your new trailers under
            Equipment before saving.
          </InlineAlert>
        ) : null}
      </div>
    ),
    equipment: <EquipmentSection draft={draft} onChange={update} errors={errors} />,
    capacity: <CapacitySection draft={draft} onChange={update} errors={errors} />,
    location: <LocationSection draft={draft} onChange={update} errors={errors} allowOff />,
    preferences: <PreferencesSection draft={draft} onChange={update} errors={errors} />,
  };

  return (
    <div className="stack-lg">
      <ProfileSummary profile={baseline} user={user} />

      <nav className="scroll-row drv-section-nav" aria-label="Jump to a section">
        {SECTIONS.map((s) => (
          <Chip
            key={s.id}
            onClick={() => {
              const el = document.getElementById(sectionDomId(s.id));
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              el?.focus({ preventScroll: true });
            }}
          >
            {s.title}
          </Chip>
        ))}
      </nav>

      <form className="stack-lg" onSubmit={save} noValidate aria-label="Rig and preferences">
        {formError ? (
          <InlineAlert tone="bad" title="Couldn’t save your changes">
            {formError}
          </InlineAlert>
        ) : null}

        {SECTIONS.map((s) => (
          <Card key={s.id} as="section" id={sectionDomId(s.id)} tabIndex={-1} title={s.title} subtitle={s.subtitle}>
            {sectionBody[s.id]}
          </Card>
        ))}

        {dirty ? (
          <div className="drv-savebar" role="region" aria-label="Unsaved changes" ref={pinnedBarRef}>
            <p className="drv-savebar__text">
              <Icon name="warning" size={18} />
              Unsaved changes
            </p>
            <div className="drv-savebar__actions">
              <Button variant="secondary" onClick={() => setConfirmDiscard(true)} disabled={saving}>
                Discard
              </Button>
              <Button type="submit" icon="check" loading={saving}>
                Save changes
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      <ConfirmDialog
        open={confirmDiscard && dirty}
        tone="danger"
        title="Discard your changes?"
        message="Everything you changed since the last save goes back to how it was."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        tone="danger"
        title="Leave without saving?"
        message="Your rig and preference changes haven’t been saved."
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}

function ProfileSummary({ profile, user }: { profile: DriverProfile; user: User }) {
  return (
    <Card muted>
      <div className="drv-summary">
        <Avatar name={user.name} size="lg" />
        <div className="drv-summary__who">
          <p className="drv-summary__name">{user.name}</p>
          <p className="muted">
            {[user.company, driverClassLabel(profile.driverClass), profile.equipmentTypes.length ? equipmentList(profile.equipmentTypes) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="muted text-sm num">
            <Icon name="star" size={14} /> {rating(profile.rating)}
            {profile.completedLoads ? ` · ${plural(profile.completedLoads, 'load')} delivered` : ''}
            {profile.currentLocation ? ` · Empty in ${place(profile.currentLocation)}` : ''}
          </p>
        </div>
        <div className="row">
          {profile.profileComplete ? (
            <Badge tone="ok" icon="check">
              Ready for loads
            </Badge>
          ) : (
            <Badge tone="warn" icon="warning">
              Setup unfinished
            </Badge>
          )}
          {profile.available ? null : <Badge tone="neutral">Not taking loads</Badge>}
        </div>
      </div>
    </Card>
  );
}
