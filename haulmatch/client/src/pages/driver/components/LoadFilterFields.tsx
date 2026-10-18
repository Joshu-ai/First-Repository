// The load search controls, shared by the board's filter panel/sheet and the alert editor.
import type { DriverClass } from '../../../../../shared/types';
import { CityInput } from '../../../components/CityInput';
import { EquipmentPicker } from '../../../components/Equipment';
import { NumberInput, Select, Switch, TextInput, type SelectOption } from '../../../components/Form';
import { Icon } from '../../../components/Icon';
import { StateMultiSelect } from '../../../components/StateMultiSelect';
import { rememberCity } from './cities';
import { RADIUS_CHOICES, type FilterDraft, type FilterErrors, type HazmatChoice } from './filterDraft';

const HAZMAT_OPTIONS: SelectOption<HazmatChoice>[] = [
  { value: 'any', label: 'Hazmat or not' },
  { value: 'only', label: 'Hazmat loads only' },
  { value: 'none', label: 'No hazmat' },
];

export interface LoadFilterFieldsProps {
  draft: FilterDraft;
  onChange: (patch: Partial<FilterDraft>) => void;
  driverClass: DriverClass;
  errors?: FilterErrors;
  /** Offer "Show loads I can't take" (the board; alerts only ever ping for loads you can take). */
  showIneligible?: boolean;
}

export function LoadFilterFields({ draft, onChange, driverClass, errors = {}, showIneligible = true }: LoadFilterFieldsProps) {
  const radiusOptions: SelectOption<string>[] = [...new Set([...RADIUS_CHOICES, draft.originRadiusMiles])]
    .sort((a, b) => a - b)
    .map((r) => ({ value: String(r), label: `Within ${r} mi` }));

  return (
    <div className="stack-lg">
      <div className="stack">
        <CityInput
          label="Pickup near"
          value={draft.originCity}
          onChange={(originCity) => {
            rememberCity(originCity);
            onChange({ originCity });
          }}
          placeholder="e.g. Midland, TX"
          hint={
            !draft.originCity
              ? 'Leave empty for loads within your max deadhead.'
              : showIneligible
                ? 'Shows pickups near this city even past your max deadhead, so you can plan the next run.'
                : 'Alerts ping for pickups near this city even past your max deadhead from where you’re empty.'
          }
          error={errors.originCity}
          optional
        />
        <Select
          label="Pickup radius"
          value={String(draft.originRadiusMiles)}
          onChange={(v) => onChange({ originRadiusMiles: Number(v) })}
          options={radiusOptions}
          disabled={!draft.originCity}
          hint={draft.originCity ? undefined : 'Pick a city first.'}
          error={errors.originRadiusMiles}
        />
      </div>

      <StateMultiSelect
        label="Delivers to"
        optional
        value={draft.destinationStates}
        onChange={(destinationStates) => onChange({ destinationStates })}
        placeholder="Any state. Add one…"
        error={errors.destinationStates}
      />

      <EquipmentPicker
        label="Equipment"
        compact
        classes={[driverClass]}
        value={draft.equipment}
        onChange={(equipment) => onChange({ equipment })}
        hint="None picked = any of your setups."
        error={errors.equipment}
      />

      <div className="form-row">
        <NumberInput
          label="Min posted rate"
          prefix="$"
          suffix="/mi"
          decimal
          value={draft.minRatePerMile}
          onChange={(minRatePerMile) => onChange({ minRatePerMile })}
          error={errors.minRatePerMile}
          optional
        />
        <NumberInput
          label="Max weight"
          suffix="lbs"
          value={draft.maxWeightLbs}
          onChange={(maxWeightLbs) => onChange({ maxWeightLbs })}
          error={errors.maxWeightLbs}
          optional
        />
      </div>

      <div className="form-row">
        <TextInput
          label="Pickup from"
          type="date"
          value={draft.pickupFrom}
          onChange={(e) => onChange({ pickupFrom: e.target.value })}
          error={errors.pickupFrom}
          optional
        />
        <TextInput
          label="Pickup by"
          type="date"
          value={draft.pickupTo}
          min={draft.pickupFrom || undefined}
          onChange={(e) => onChange({ pickupTo: e.target.value })}
          error={errors.pickupTo}
          optional
        />
      </div>

      <Select
        label="Hazmat"
        value={draft.hazmat}
        onChange={(hazmat) => onChange({ hazmat })}
        options={HAZMAT_OPTIONS}
        error={errors.hazmat}
      />

      <TextInput
        label="Keyword"
        type="search"
        prefix={<Icon name="search" size={18} />}
        placeholder="Commodity, city, shipper or ref #"
        value={draft.q}
        onChange={(e) => onChange({ q: e.target.value })}
        maxLength={80}
        error={errors.q}
        optional
      />

      {showIneligible ? (
        <Switch
          label="Show loads I can’t take"
          description="Dimmed, with the reason they don’t fit your rig."
          checked={draft.includeIneligible}
          onChange={(includeIneligible) => onChange({ includeIneligible })}
        />
      ) : null}
    </div>
  );
}
