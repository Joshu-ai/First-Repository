import { useEffect, useState, type FormEvent } from 'react';
import type { City, DriverProfile } from '../../../../../shared/types';
import { Button } from '../../../components/Button';
import { CityInput, placeToCityOrNull } from '../../../components/CityInput';
import { Chip } from '../../../components/Badge';
import { InlineAlert } from '../../../components/Feedback';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { ApiError, api, errorMessage } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { pickupTime, place } from '../../../lib/format';
import { rememberCity } from './cities';
import { AvailabilityFields } from './ProfileSections';
import type { Availability } from './profileForm';

export interface LocationDialogProps {
  open: boolean;
  onClose: () => void;
  profile: DriverProfile;
  /** Called with the saved profile (already stored in the auth context). */
  onSaved?: (profile: DriverProfile) => void;
}

interface Errors {
  cityId?: string;
  availableFrom?: string;
}

/** "I'm empty in Tulsa": PATCH /api/drivers/me/location from the load board header. */
export function LocationDialog({ open, onClose, profile, onSaved }: LocationDialogProps) {
  const { setDriverProfile } = useAuth();
  const toast = useToast();
  const [city, setCity] = useState<City | null>(null);
  const [availability, setAvailability] = useState<Availability>('now');
  const [availableFrom, setAvailableFrom] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Start from the saved profile each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const later = profile.availableFrom !== null && Date.parse(profile.availableFrom) > Date.now();
    setCity(placeToCityOrNull(profile.currentLocation));
    setAvailability(later ? 'later' : 'now');
    setAvailableFrom(later ? profile.availableFrom : null);
    setErrors({});
    setFormError(null);
  }, [open, profile]);

  const home = profile.homeBase;
  const atHome = home !== null && city?.id === home.cityId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (!city) found.cityId = 'Pick the city where you’re empty';
    if (availability === 'later') {
      if (!availableFrom) found.availableFrom = 'Pick when you’ll be empty';
      else if (Date.parse(availableFrom) <= Date.now()) found.availableFrom = 'That time has passed. Pick “Empty now” or a later time';
    }
    setErrors(found);
    setFormError(null);
    if (!city || Object.keys(found).length) return;

    setSaving(true);
    try {
      const saved = await api.drivers.updateMyLocation({
        cityId: city.id,
        available: true,
        availableFrom: availability === 'later' ? availableFrom : null,
      });
      setDriverProfile(saved);
      onSaved?.(saved);
      toast.success(
        `Empty in ${place(city)}`,
        availability === 'later' && availableFrom ? `From ${pickupTime(availableFrom)}. Matches updated.` : 'Deadhead and matches are updated.',
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        const next: Errors = { cityId: fields.cityId, availableFrom: fields.availableFrom };
        if (next.cityId || next.availableFrom) setErrors(next);
        else setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Where are you empty?"
      description="Deadhead, timing and match scores are worked out from here."
      size="sm"
      dismissible={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="drv-location-form" loading={saving} icon="pin">
            Update location
          </Button>
        </>
      }
    >
      <form id="drv-location-form" className="stack" onSubmit={submit} noValidate>
        {formError ? (
          <InlineAlert tone="bad" title="Couldn’t update your location">
            {formError}
          </InlineAlert>
        ) : null}
        <CityInput
          label="City"
          value={city}
          onChange={(next) => {
            rememberCity(next);
            setCity(next);
            setErrors((prev) => ({ ...prev, cityId: undefined }));
          }}
          error={errors.cityId}
          required
        />
        {home && !atHome ? (
          <div className="row">
            <Chip
              icon="home"
              onClick={() => {
                setCity(placeToCityOrNull(home));
                setErrors((prev) => ({ ...prev, cityId: undefined }));
              }}
            >
              Home: {place(home)}
            </Chip>
          </div>
        ) : null}
        <AvailabilityFields
          availability={availability}
          availableFrom={availableFrom}
          onChange={(patch) => {
            if (patch.availability) setAvailability(patch.availability);
            if (patch.availableFrom !== undefined) setAvailableFrom(patch.availableFrom);
            setErrors((prev) => ({ ...prev, availableFrom: undefined }));
          }}
          errors={errors}
        />
      </form>
    </Modal>
  );
}
