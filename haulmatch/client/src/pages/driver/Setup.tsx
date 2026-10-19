import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { DriverClass, DriverProfile } from '../../../../shared/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState, InlineAlert, Skeleton } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cx } from '../../lib/cx';
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
  SECTION_ORDER,
  changeDriverClass,
  draftFromProfile,
  errorsFromApi,
  firstSectionWithError,
  hasErrors,
  sectionUpdate,
  suggestCapacity,
  validateSection,
  type ProfileDraft,
  type ProfileErrors,
  type SectionId,
} from './components/profileForm';
import './components/driver.css';

interface StepInfo {
  id: SectionId;
  title: string;
  lede: string;
}

const STEPS: Record<SectionId, StepInfo> = {
  rig: { id: 'rig', title: 'Rig type', lede: 'Hotshot or semi? It decides which equipment and loads you see. You can switch later.' },
  equipment: { id: 'equipment', title: 'Equipment', lede: 'The trailers you can pull. Loads list the setups they accept.' },
  capacity: {
    id: 'capacity',
    title: 'Capacity',
    lede: 'Deck length, payload and license, so you only see freight you can legally haul.',
  },
  location: { id: 'location', title: 'Location', lede: 'Where you’re empty and when. Deadhead and timing come from this.' },
  preferences: {
    id: 'preferences',
    title: 'Preferences',
    lede: 'How far you’ll run empty, what pays enough, and your fuel numbers for profit estimates.',
  },
};

const ORDERED_STEPS = SECTION_ORDER.map((id) => STEPS[id]);

export default function DriverSetupPage() {
  const { driverProfile } = useAuth();
  // The auth context normally has the profile already; fetch it only if it does not.
  const fetched = useApi((signal) => api.drivers.myProfile({ signal }), [], { enabled: !driverProfile });
  const profile = driverProfile ?? fetched.data;

  return (
    <div className="container container--narrow">
      <PageHeader
        eyebrow="Welcome to HaulMatch"
        title="Set up your rig"
        subtitle="Five quick steps so we only show loads you can actually haul."
      />
      {profile ? (
        <SetupWizard profile={profile} />
      ) : fetched.error ? (
        <ErrorState error={fetched.error} title="Couldn’t load your profile" onRetry={() => void fetched.reload()} />
      ) : (
        <Card aria-busy="true">
          <div className="stack" role="status" aria-label="Loading your profile">
            <Skeleton width="40%" height={14} />
            <Skeleton height={88} radius="12px" />
            <Skeleton height={88} radius="12px" />
          </div>
        </Card>
      )}
    </div>
  );
}

function SetupWizard({ profile }: { profile: DriverProfile }) {
  const { setDriverProfile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A returning driver already chose their numbers; a new one gets them prefilled from the
  // equipment they pick until they type their own.
  const capacityTouched = useRef(profile.equipmentTypes.length > 0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const step = ORDERED_STEPS[stepIndex];
  const isLast = stepIndex === ORDERED_STEPS.length - 1;

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  const clearErrors = (keys: string[]) => {
    if (keys.some((k) => k in errors)) {
      setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))) as ProfileErrors);
    }
  };

  const withSuggestedCapacity = (next: ProfileDraft): ProfileDraft => {
    if (capacityTouched.current) return next;
    const suggestion = suggestCapacity(next);
    return suggestion
      ? { ...next, trailerLengthFt: suggestion.trailerLengthFt, maxPayloadLbs: suggestion.maxPayloadLbs }
      : next;
  };

  const update = (patch: Partial<ProfileDraft>) => {
    if ('trailerLengthFt' in patch || 'maxPayloadLbs' in patch) capacityTouched.current = true;
    const affectsSuggestion = 'equipmentTypes' in patch || 'hasCdl' in patch;
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      return affectsSuggestion ? withSuggestedCapacity(next) : next;
    });
    const keys = Object.keys(patch).map((k) => (k === 'currentCity' ? 'currentCityId' : k === 'homeCity' ? 'homeCityId' : k));
    if (patch.availability) keys.push('available', 'availableFrom');
    clearErrors(keys);
  };

  const changeClass = (next: DriverClass) => {
    setDraft((prev) => withSuggestedCapacity(changeDriverClass(prev, next)));
    clearErrors(['driverClass', 'equipmentTypes']);
  };

  const goTo = (index: number) => {
    setErrors({});
    setFormError(null);
    setStepIndex(index);
  };

  const focusFirstError = () => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.field--invalid input:not([disabled]), [aria-invalid="true"]')
        ?.focus();
    });
  };

  const saveStep = async () => {
    const found = validateSection(step.id, draft);
    setErrors(found);
    setFormError(null);
    if (hasErrors(found)) {
      focusFirstError();
      return;
    }
    setSaving(true);
    try {
      const saved = await api.drivers.updateMyProfile(sectionUpdate(step.id, draft));
      setDriverProfile(saved);
      if (isLast) {
        toast.success('You’re set up', 'Here are the loads that fit your rig.');
        navigate(paths.driverLoads, { replace: true });
        return;
      }
      setStepIndex((i) => i + 1);
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? errorsFromApi(err) : {};
      if (hasErrors(fieldErrors)) {
        setErrors(fieldErrors);
        const section = firstSectionWithError(fieldErrors);
        const index = section ? SECTION_ORDER.indexOf(section) : -1;
        if (index >= 0 && index !== stepIndex) setStepIndex(index);
        focusFirstError();
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack-lg">
      <WizardProgress current={stepIndex} onJump={goTo} disabled={saving} />

      <form
        className="stack-lg"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void saveStep();
        }}
      >
        <Card as="section" aria-labelledby="setup-step-title">
          <div className="stack-lg">
            <div className="stack-xs">
              <h2 id="setup-step-title" className="section-title drv-step-heading" ref={headingRef} tabIndex={-1}>
                {step.title}
              </h2>
              <p className="muted">{step.lede}</p>
            </div>
            {formError ? (
              <InlineAlert tone="bad" title="Couldn’t save this step">
                {formError}
              </InlineAlert>
            ) : null}
            {step.id === 'rig' ? <RigTypeSection draft={draft} onClassChange={changeClass} errors={errors} /> : null}
            {step.id === 'equipment' ? <EquipmentSection draft={draft} onChange={update} errors={errors} /> : null}
            {step.id === 'capacity' ? <CapacitySection draft={draft} onChange={update} errors={errors} /> : null}
            {step.id === 'location' ? <LocationSection draft={draft} onChange={update} errors={errors} /> : null}
            {step.id === 'preferences' ? <PreferencesSection draft={draft} onChange={update} errors={errors} /> : null}
          </div>
        </Card>

        <div className="action-bar" ref={pinnedBarRef}>
          {stepIndex > 0 ? (
            <Button
              variant="secondary"
              size="lg"
              icon="arrowLeft"
              className="drv-back"
              onClick={() => goTo(stepIndex - 1)}
              disabled={saving}
            >
              <span className="drv-back__label">Back</span>
              <span className="visually-hidden drv-back__sr">Back</span>
            </Button>
          ) : null}
          <Button type="submit" size="lg" iconAfter={isLast ? 'check' : 'arrowRight'} loading={saving}>
            {isLast ? 'Finish and see loads' : `Next: ${ORDERED_STEPS[stepIndex + 1].title}`}
          </Button>
        </div>
      </form>
    </div>
  );
}

function WizardProgress({ current, onJump, disabled }: { current: number; onJump: (index: number) => void; disabled: boolean }) {
  const step = ORDERED_STEPS[current];
  return (
    <nav className="drv-progress" aria-label="Setup progress">
      <p className="drv-progress__count" aria-hidden="true">
        Step {current + 1} of {ORDERED_STEPS.length} · <strong>{step.title}</strong>
      </p>
      <ol className="drv-steps">
        {ORDERED_STEPS.map((s, i) => {
          const done = i < current;
          const state = done ? 'done' : i === current ? 'current' : 'upcoming';
          const content = (
            <>
              <span className="drv-steps__bar" aria-hidden="true" />
              <span className="drv-steps__label" aria-hidden="true">
                {done ? <Icon name="check" size={14} /> : null}
                {s.title}
              </span>
              <span className="visually-hidden">
                {`Step ${i + 1} of ${ORDERED_STEPS.length}: ${s.title}`}
                {done ? ' (done, go back)' : i === current ? ' (current)' : ''}
              </span>
            </>
          );
          return (
            <li key={s.id} className={cx('drv-steps__item', `is-${state}`)} aria-current={i === current ? 'step' : undefined}>
              {done ? (
                <button type="button" className="drv-steps__step" onClick={() => onJump(i)} disabled={disabled}>
                  {content}
                </button>
              ) : (
                <span className="drv-steps__step">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
