import { useEffect, useState, type FormEvent } from 'react';
import type { BookLoadResponse, LoadWithMatch, MatchCheck } from '../../../../../shared/types';
import { Button } from '../../../components/Button';
import { InlineAlert } from '../../../components/Feedback';
import { Checkbox, NumberInput, TextArea } from '../../../components/Form';
import { ProfitSummary } from '../../../components/MatchDetails';
import { Modal } from '../../../components/Modal';
import { ApiError, api, errorMessage, type BookInput } from '../../../lib/api';
import { lane, money, pickupTime, ratePerMile } from '../../../lib/format';

const MESSAGE_MAX = 500;
const OFFER_MIN = 50;
const OFFER_MAX = 100_000;

export interface BookDialogProps {
  open: boolean;
  onClose: () => void;
  load: LoadWithMatch;
  onBooked: (result: BookLoadResponse) => void;
  /** The load changed under us (taken or no longer eligible): the page should reload it. */
  onStale?: () => void;
}

interface Errors {
  message?: string;
  offerRateUsd?: string;
}

function failedChecks(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return (details as MatchCheck[]).filter((c) => c && typeof c.label === 'string').map((c) => c.label);
}

/**
 * Book an instant load or request a request-mode load, with an optional note and counter-offer.
 * A counter-offer always goes to the shipper as a request, even on an instant-book load.
 */
export function BookDialog({ open, onClose, load, onBooked, onStale }: BookDialogProps) {
  const [message, setMessage] = useState('');
  const [countering, setCountering] = useState(false);
  const [offer, setOffer] = useState<number | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<{ title: string; body: string; items?: string[] } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setCountering(false);
    setOffer(null);
    setErrors({});
    setFormError(null);
  }, [open, load.id]);

  const instantMode = load.bookingMode === 'instant';
  const instant = instantMode && !countering;
  const offerValid = countering && offer !== null && offer >= OFFER_MIN && offer <= OFFER_MAX;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (message.length > MESSAGE_MAX) found.message = `Keep it under ${MESSAGE_MAX} characters`;
    if (countering) {
      if (offer === null) found.offerRateUsd = 'Enter the rate you want';
      else if (offer < OFFER_MIN || offer > OFFER_MAX) found.offerRateUsd = `Offers run ${money(OFFER_MIN)} to ${money(OFFER_MAX)}`;
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;

    const input: BookInput = {};
    if (message.trim()) input.message = message.trim();
    if (countering && offer !== null) input.offerRateUsd = offer;

    setPending(true);
    try {
      const result = await api.loads.book(load.id, input);
      onBooked(result);
      onClose();
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setFormError({ title: 'Couldn’t send it', body: errorMessage(err) });
      } else if (err.status === 409) {
        setFormError({ title: 'This load just changed', body: err.message });
        onStale?.();
      } else if (err.status === 422 && err.code === 'not_eligible') {
        setFormError({ title: 'This load no longer fits your rig', body: err.message, items: failedChecks(err.details) });
        onStale?.();
      } else if (err.status === 422) {
        setFormError({ title: 'Finish your rig setup first', body: err.message });
      } else {
        const fields = err.fieldErrors();
        if (fields.message || fields.offerRateUsd) setErrors({ message: fields.message, offerRateUsd: fields.offerRateUsd });
        else setFormError({ title: 'Couldn’t send it', body: errorMessage(err) });
      }
    } finally {
      setPending(false);
    }
  };

  const confirmLabel = instant
    ? `Book now · ${money(load.rateUsd)}`
    : countering && offerValid && offer !== null
      ? `Send offer · ${money(offer)}`
      : 'Send request';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={instant ? 'Book this load' : 'Request this load'}
      description={`${lane(load.origin, load.destination)} · Pickup ${pickupTime(load.pickupStart)}`}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="drv-book-form" size="lg" loading={pending} icon={instant ? 'bolt' : 'send'}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="drv-book-form" className="stack" onSubmit={submit} noValidate>
        {formError ? (
          <InlineAlert tone="bad" title={formError.title}>
            <p>{formError.body}</p>
            {formError.items?.length ? (
              <ul className="drv-failed">
                {formError.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </InlineAlert>
        ) : null}

        {instant ? (
          <InlineAlert tone="ok" title="Instant book">
            It’s yours the moment you confirm, at the posted {money(load.rateUsd)}.
          </InlineAlert>
        ) : (
          <InlineAlert tone="info" title="The shipper confirms">
            {load.shipperCompany ?? load.shipperName} reviews requests and picks a driver. We’ll notify you either way.
          </InlineAlert>
        )}

        <Checkbox
          label="Counter-offer a different rate"
          description={
            instantMode
              ? 'Turns this into a request: the shipper has to accept your rate before the load is yours.'
              : `Posted at ${money(load.rateUsd)} (${ratePerMile(load.ratePerMile)}).`
          }
          checked={countering}
          onChange={(on) => {
            setCountering(on);
            setErrors((prev) => ({ ...prev, offerRateUsd: undefined }));
          }}
        />
        {countering ? (
          <NumberInput
            label="Your rate"
            prefix="$"
            value={offer}
            onChange={(next) => {
              setOffer(next);
              setErrors((prev) => ({ ...prev, offerRateUsd: undefined }));
            }}
            hint={
              offer !== null && offer > 0
                ? `${ratePerMile(offer / Math.max(1, load.miles))} loaded. Posted: ${money(load.rateUsd)}.`
                : `All-in for the load. Posted: ${money(load.rateUsd)}.`
            }
            error={errors.offerRateUsd}
            autoFocus
            required
          />
        ) : null}

        <TextArea
          label="Note for the shipper"
          optional
          rows={3}
          maxLength={MESSAGE_MAX}
          placeholder="ETA to pickup, questions about the freight, straps or tarps on board…"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setErrors((prev) => ({ ...prev, message: undefined }));
          }}
          error={errors.message}
        />

        <ProfitSummary load={load} match={load.match} offerRateUsd={offerValid ? offer : null} />
      </form>
    </Modal>
  );
}
