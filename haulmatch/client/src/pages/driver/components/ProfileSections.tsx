// The rig profile, one component per section. Setup shows them one step at a time; the
// profile page stacks them. Each section edits a ProfileDraft and shows errors by API field name.
import { DRIVER_CLASSES, NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS } from '../../../../../shared/equipment';
import type { DriverClass, Endorsement } from '../../../../../shared/types';
import { CityInput } from '../../../components/CityInput';
import { DateTimeInput } from '../../../components/DateTimeInput';
import { EquipmentPicker } from '../../../components/Equipment';
import { InlineAlert } from '../../../components/Feedback';
import { Checkbox, NumberInput, RadioCards, Switch, TextInput, type RadioCardOption } from '../../../components/Form';
import { Icon } from '../../../components/Icon';
import { StateMultiSelect } from '../../../components/StateMultiSelect';
import { endorsementLabel, feet, lbs, money, number } from '../../../lib/format';
import { HotshotArt, SemiArt } from '../../public/illustrations';
import { rememberCity } from './cities';
import {
  CDL_ONLY_ENDORSEMENTS,
  ENDORSEMENTS,
  LIMITS,
  fuelCostPerMile,
  suggestCapacity,
  type Availability,
  type ProfileDraft,
  type ProfileErrors,
} from './profileForm';

export interface SectionProps {
  draft: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
  errors: ProfileErrors;
}

// ---------------------------------------------------------------------------
// Rig type
// ---------------------------------------------------------------------------

const CLASS_OPTIONS: RadioCardOption<DriverClass>[] = [
  {
    value: 'hotshot',
    title: 'Hotshot',
    description: 'Pickup, usually a 1-ton dually, pulling a gooseneck, bumper pull, dovetail or car hauler.',
    media: <HotshotArt height={44} />,
  },
  {
    value: 'semi',
    title: 'Semi',
    description: 'Class 8 tractor-trailer: dry van, reefer, flatbed, step deck, RGN, tanker and more.',
    media: <SemiArt height={44} />,
  },
];

export function RigTypeSection({
  draft,
  onClassChange,
  errors,
}: {
  draft: ProfileDraft;
  onClassChange: (next: DriverClass) => void;
  errors: ProfileErrors;
}) {
  return (
    <RadioCards
      label="What do you drive?"
      options={CLASS_OPTIONS}
      value={draft.driverClass}
      onChange={onClassChange}
      error={errors.driverClass}
      size="lg"
      columns={2}
    />
  );
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export function EquipmentSection({ draft, onChange, errors }: SectionProps) {
  return (
    <EquipmentPicker
      label={draft.driverClass === 'hotshot' ? 'Which hotshot trailers do you run?' : 'Which trailers can you pull?'}
      hint="Pick every setup you run. You’ll see loads that take any of them."
      classes={[draft.driverClass]}
      value={draft.equipmentTypes}
      onChange={(equipmentTypes) => onChange({ equipmentTypes })}
      error={errors.equipmentTypes}
    />
  );
}

// ---------------------------------------------------------------------------
// Capacity and credentials
// ---------------------------------------------------------------------------

const ENDORSEMENT_HINTS: Record<Endorsement, string> = {
  hazmat: 'Placarded hazardous materials.',
  tanker: 'Liquid or bulk tank loads.',
  doubles_triples: 'Pulling doubles or triples.',
  twic: 'Port and terminal access card. No CDL needed.',
};

const CDL_OPTIONS: RadioCardOption<'A' | 'B'>[] = [
  { value: 'A', title: 'Class A', description: 'Tractor-trailers and heavy hotshot combinations.' },
  { value: 'B', title: 'Class B', description: 'Straight trucks, towing up to 10,000 lbs.' },
];

export function CapacitySection({ draft, onChange, errors }: SectionProps) {
  const hotshot = draft.driverClass === 'hotshot';
  const suggestion = suggestCapacity(draft);
  const showSuggestion =
    suggestion !== null &&
    (suggestion.trailerLengthFt !== draft.trailerLengthFt || suggestion.maxPayloadLbs !== draft.maxPayloadLbs);
  const overNonCdl = hotshot && !draft.hasCdl && (draft.maxPayloadLbs ?? 0) > NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS;

  const setCdl = (hasCdl: boolean) => onChange({ hasCdl, cdlClass: hasCdl ? (draft.cdlClass ?? 'A') : null });
  const toggleEndorsement = (e: Endorsement, on: boolean) =>
    onChange({ endorsements: on ? [...draft.endorsements.filter((x) => x !== e), e] : draft.endorsements.filter((x) => x !== e) });

  return (
    <div className="stack-lg">
      <div className="stack">
        <div className="form-row">
          <NumberInput
            label="Deck length"
            suffix="ft"
            value={draft.trailerLengthFt}
            onChange={(trailerLengthFt) => onChange({ trailerLengthFt })}
            hint={`Usable deck or box length, ${LIMITS.trailerLengthFt.min}–${LIMITS.trailerLengthFt.max} ft.`}
            error={errors.trailerLengthFt}
            required
          />
          <NumberInput
            label="Max payload"
            suffix="lbs"
            value={draft.maxPayloadLbs}
            onChange={(maxPayloadLbs) => onChange({ maxPayloadLbs })}
            hint={
              hotshot
                ? `Non-CDL hotshots usually stay near ${number(NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS)} lbs of freight.`
                : 'Freight weight you can legally scale with.'
            }
            error={errors.maxPayloadLbs}
            required
          />
        </div>
        {showSuggestion && suggestion ? (
          <p className="drv-fuel-note">
            <Icon name="info" size={16} />
            <span>
              Typical for {suggestion.basis}: {feet(suggestion.trailerLengthFt)} · {lbs(suggestion.maxPayloadLbs)}
              {suggestion.cappedForNonCdl ? ' (held to the non-CDL limit)' : ''}.{' '}
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  onChange({ trailerLengthFt: suggestion.trailerLengthFt, maxPayloadLbs: suggestion.maxPayloadLbs })
                }
              >
                Use these
              </button>
            </span>
          </p>
        ) : null}
        {hotshot ? (
          <p className="muted text-sm">
            A 1-ton dually and gooseneck weigh about 15,000 lbs empty. Past 26,000 lbs combined with a trailer over
            10,000 lbs you need a Class A CDL.
          </p>
        ) : null}
        {overNonCdl ? (
          <InlineAlert tone="warn" title={`Over ${number(NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS)} lbs needs a CDL`}>
            Without a CDL you’ll only match loads up to {lbs(NON_CDL_HOTSHOT_MAX_PAYLOAD_LBS)}, whatever you enter here.
          </InlineAlert>
        ) : null}
      </div>

      <fieldset className="stack">
        <legend className="field__label">License</legend>
        <Switch
          label="I have a CDL"
          description={hotshot ? 'Lets you take heavier hotshot freight.' : 'Semi freight needs a Class A CDL.'}
          checked={draft.hasCdl}
          onChange={setCdl}
        />
        {draft.hasCdl ? (
          <RadioCards
            label="CDL class"
            options={CDL_OPTIONS}
            value={draft.cdlClass}
            onChange={(cdlClass) => onChange({ cdlClass })}
            error={errors.cdlClass}
            columns={2}
          />
        ) : null}
        {!hotshot && !draft.hasCdl ? (
          <InlineAlert tone="warn" title="Semi freight needs a Class A CDL">
            Without one, semi loads will show as not a fit for your rig.
          </InlineAlert>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="field__label">Endorsements</legend>
        <div className="grid-2">
          {ENDORSEMENTS.map((e) => {
            const needsCdl = CDL_ONLY_ENDORSEMENTS.includes(e) && !draft.hasCdl;
            return (
              <Checkbox
                key={e}
                label={endorsementLabel(e)}
                description={needsCdl ? 'Needs a CDL.' : ENDORSEMENT_HINTS[e]}
                checked={!needsCdl && draft.endorsements.includes(e)}
                disabled={needsCdl}
                onChange={(on) => toggleEndorsement(e, on)}
              />
            );
          })}
        </div>
        {errors.endorsements ? <p className="field__error">{errors.endorsements}</p> : null}
      </fieldset>

      <Switch
        label="I run team"
        description="Two drivers, so you can take team-only loads."
        checked={draft.teamDriver}
        onChange={(teamDriver) => onChange({ teamDriver })}
      />

      <TextInput
        label="Truck and trailer"
        optional
        placeholder={hotshot ? '2022 Ram 3500 dually + 40′ PJ gooseneck' : '2021 Freightliner Cascadia + 48′ flatbed'}
        value={draft.truckDescription}
        onChange={(e) => onChange({ truckDescription: e.target.value })}
        maxLength={LIMITS.truckDescription.max}
        hint="Shippers see this when you request a load."
        error={errors.truckDescription}
      />
      <div className="form-row">
        <TextInput
          label="MC number"
          optional
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 1184520"
          value={draft.mcNumber}
          onChange={(e) => onChange({ mcNumber: e.target.value })}
          error={errors.mcNumber}
        />
        <TextInput
          label="USDOT number"
          optional
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 3365871"
          value={draft.dotNumber}
          onChange={(e) => onChange({ dotNumber: e.target.value })}
          error={errors.dotNumber}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Location and availability
// ---------------------------------------------------------------------------

const AVAILABILITY_OPTIONS: RadioCardOption<Availability>[] = [
  { value: 'now', title: 'Empty now', description: 'Ready to load today.' },
  { value: 'later', title: 'Empty later', description: 'Pick the day and time.' },
  { value: 'off', title: 'Not taking loads', description: 'No hot-match pings until you’re back.' },
];

/** 7:00 AM tomorrow, local time: a sensible first guess for "empty later". */
function tomorrowMorningIso(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0, 0, 0);
  return d.toISOString();
}

export function AvailabilityFields({
  availability,
  availableFrom,
  onChange,
  errors,
  allowOff,
}: {
  availability: Availability;
  availableFrom: string | null;
  onChange: (patch: { availability?: Availability; availableFrom?: string | null }) => void;
  errors: { available?: string; availableFrom?: string };
  allowOff?: boolean;
}) {
  const options = allowOff ? AVAILABILITY_OPTIONS : AVAILABILITY_OPTIONS.filter((o) => o.value !== 'off');
  return (
    <>
      <RadioCards
        label="When can you load?"
        options={options}
        value={availability}
        onChange={(next) =>
          onChange({ availability: next, availableFrom: next === 'later' ? (availableFrom ?? tomorrowMorningIso()) : availableFrom })
        }
        error={errors.available}
        columns={allowOff ? 3 : 2}
      />
      {availability === 'later' ? (
        <DateTimeInput
          label="Empty from"
          value={availableFrom}
          onChange={(availableFrom) => onChange({ availableFrom })}
          min={new Date().toISOString()}
          hint="Your local time. Loads you can’t reach after this show as late."
          error={errors.availableFrom}
          required
        />
      ) : null}
    </>
  );
}

export function LocationSection({ draft, onChange, errors, allowOff }: SectionProps & { allowOff?: boolean }) {
  return (
    <div className="stack-lg">
      <CityInput
        label="Where are you empty?"
        value={draft.currentCity}
        onChange={(currentCity) => {
          rememberCity(currentCity);
          onChange({ currentCity });
        }}
        hint="Deadhead is measured from here. Update it whenever you drop a load."
        error={errors.currentCityId}
        required
      />
      <CityInput
        label="Home base"
        value={draft.homeCity}
        onChange={(homeCity) => {
          rememberCity(homeCity);
          onChange({ homeCity });
        }}
        hint="Loads that head toward home rank higher."
        error={errors.homeCityId}
        optional
      />
      <AvailabilityFields
        availability={draft.availability}
        availableFrom={draft.availableFrom}
        onChange={onChange}
        errors={errors}
        allowOff={allowOff}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export function PreferencesSection({ draft, onChange, errors }: SectionProps) {
  const defaults = DRIVER_CLASSES[draft.driverClass];
  const perMile = fuelCostPerMile(draft);
  return (
    <div className="stack-lg">
      <div className="form-row">
        <NumberInput
          label="Max deadhead"
          suffix="mi"
          value={draft.maxDeadheadMiles}
          onChange={(maxDeadheadMiles) => onChange({ maxDeadheadMiles })}
          hint="Farthest you’ll run empty to a pickup."
          error={errors.maxDeadheadMiles}
          required
        />
        <NumberInput
          label="Minimum all-in rate"
          prefix="$"
          suffix="/mi"
          decimal
          value={draft.minRatePerMile}
          onChange={(minRatePerMile) => onChange({ minRatePerMile })}
          hint="Counts deadhead miles too. Loads under it rank lower."
          error={errors.minRatePerMile}
          required
        />
      </div>
      <StateMultiSelect
        label="Preferred states"
        optional
        value={draft.preferredStates}
        onChange={(preferredStates) => onChange({ preferredStates })}
        exclude={draft.avoidStates}
        hint="Deliveries to these states rank higher."
        error={errors.preferredStates}
      />
      <StateMultiSelect
        label="Avoid states"
        optional
        value={draft.avoidStates}
        onChange={(avoidStates) => onChange({ avoidStates })}
        exclude={draft.preferredStates}
        hint="Loads delivering to these states are hidden."
        error={errors.avoidStates}
      />
      <div className="form-row">
        <NumberInput
          label="Fuel economy"
          suffix="mpg"
          decimal
          value={draft.mpg}
          onChange={(mpg) => onChange({ mpg })}
          hint={`Loaded average. ${defaults.defaultMpg} mpg is typical for a ${defaults.label.toLowerCase()}.`}
          error={errors.mpg}
          required
        />
        <NumberInput
          label="Diesel price"
          prefix="$"
          suffix="/gal"
          decimal
          value={draft.fuelPricePerGallon}
          onChange={(fuelPricePerGallon) => onChange({ fuelPricePerGallon })}
          hint="What you’re paying at the pump."
          error={errors.fuelPricePerGallon}
          required
        />
      </div>
      {perMile !== null ? (
        <p className="drv-fuel-note">
          <Icon name="fuel" size={16} />
          <span>
            That’s about <strong className="num">{money(perMile, { cents: true })}/mi</strong> in fuel. We take it off the
            rate to estimate profit on every load.
          </span>
        </p>
      ) : null}
    </div>
  );
}
