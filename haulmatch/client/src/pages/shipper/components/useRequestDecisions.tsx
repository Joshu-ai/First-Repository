import { useState, type ReactNode } from 'react';
import type { Booking, Load } from '../../../../../shared/types';
import { InlineAlert } from '../../../components/Feedback';
import { ConfirmDialog } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { api, errorMessage, isApiError } from '../../../lib/api';
import { lane, money } from '../../../lib/format';

export type Decision = 'accept' | 'decline';

type DecisionLoad = Pick<Load, 'id' | 'origin' | 'destination' | 'rateUsd'>;

interface PendingDecision {
  decision: Decision;
  booking: Booking;
  load: DecisionLoad;
}

export interface RequestDecisions {
  /** Opens the confirm dialog for one request. */
  ask: (decision: Decision, booking: Booking, load: DecisionLoad) => void;
  /** The booking whose decision is being sent (its buttons show a spinner). */
  busyId: string | null;
  /** Render once on the page. */
  dialog: ReactNode;
}

const driverName = (booking: Booking) => booking.driver?.name ?? 'this driver';
const firstName = (booking: Booking) => booking.driver?.name.split(' ')[0] ?? 'The driver';

/**
 * Accept / decline a booking request behind a confirm step. Accepting books the load and declines
 * every other request on it, and neither can be undone, so both ask first. A 409 or 404 means the
 * request changed underneath us (the driver withdrew, or another request was accepted): the dialog
 * closes, a toast says why, and the page reloads.
 */
export function useRequestDecisions(onDone: () => void): RequestDecisions {
  const toast = useToast();
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (busy) return;
    setPending(null);
    setError(null);
  };

  const confirm = async () => {
    if (!pending || busy) return;
    const { decision, booking, load } = pending;
    setBusy(true);
    setError(null);
    try {
      if (decision === 'accept') await api.bookings.accept(booking.id);
      else await api.bookings.decline(booking.id);
      setPending(null);
      if (decision === 'accept') {
        toast.success(
          `Booked: ${driverName(booking)}`,
          `${lane(load.origin, load.destination)} is covered. We let ${firstName(booking)} know.`,
        );
      } else {
        toast.success('Request declined', `We let ${firstName(booking)} know.`);
      }
      onDone();
    } catch (err) {
      if (isApiError(err) && (err.status === 409 || err.status === 404)) {
        setPending(null);
        toast.error(decision === 'accept' ? 'Couldn’t book this driver' : 'Couldn’t decline', errorMessage(err));
        onDone();
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  let title = '';
  let message: ReactNode = null;
  if (pending) {
    const who = firstName(pending.booking);
    if (pending.decision === 'accept') {
      const offer = pending.booking.offerRateUsd;
      const countered = offer !== null && offer !== pending.load.rateUsd;
      title = `Book ${driverName(pending.booking)}?`;
      message = (
        <>
          {who} gets the load at <strong className="num">{money(offer ?? pending.load.rateUsd)}</strong>
          {countered ? ` (their counter-offer; you posted ${money(pending.load.rateUsd)})` : ''}. Any other requests on
          this load are declined.
        </>
      );
    } else {
      title = `Decline ${driverName(pending.booking)}?`;
      message = <>We’ll let {who} know. You can still invite other drivers.</>;
    }
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={title}
      message={message}
      confirmLabel={pending?.decision === 'decline' ? 'Decline request' : 'Accept and book'}
      cancelLabel="Not yet"
      tone={pending?.decision === 'decline' ? 'danger' : 'primary'}
      pending={busy}
      onConfirm={() => void confirm()}
      onCancel={close}
    >
      {error ? (
        <InlineAlert tone="bad" title="That didn’t go through">
          {errorMessage(error)}
        </InlineAlert>
      ) : null}
    </ConfirmDialog>
  );

  return {
    ask: (decision, booking, load) => {
      setError(null);
      setPending({ decision, booking, load });
    },
    busyId: busy && pending ? pending.booking.id : null,
    dialog,
  };
}
