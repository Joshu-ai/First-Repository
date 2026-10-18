// Trip buttons with their confirm dialogs, used on the load detail page and in My trips.
import { useState } from 'react';
import type { Booking, Load } from '../../../../../shared/types';
import { Button, type ButtonSize, type ButtonVariant } from '../../../components/Button';
import { InlineAlert } from '../../../components/Feedback';
import { ConfirmDialog } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useAction } from '../../../lib/hooks';
import { lane, place } from '../../../lib/format';

interface CommonProps {
  size?: ButtonSize;
  block?: boolean;
  variant?: ButtonVariant;
  className?: string;
}

/** The next status for a load on the driver's truck, or null when there is nothing to do. */
export function nextTripStatus(load: Pick<Load, 'status'>): 'in_transit' | 'delivered' | null {
  if (load.status === 'booked') return 'in_transit';
  if (load.status === 'in_transit') return 'delivered';
  return null;
}

/** "Picked up" for a booked load, "Delivered" once it is in transit. Renders nothing otherwise. */
export function TripStatusButton({
  load,
  onDone,
  size = 'md',
  block,
  variant = 'primary',
  className,
}: CommonProps & { load: Load; onDone: (load: Load) => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const next = nextTripStatus(load);
  const action = useAction((status: 'in_transit' | 'delivered') => api.loads.setStatus(load.id, status));
  if (!next) return null;

  const pickedUp = next === 'in_transit';
  const confirm = async () => {
    const updated = await action.run(next);
    if (!updated) return;
    setConfirming(false);
    toast.success(
      pickedUp ? 'Marked picked up' : 'Delivered. Nice run!',
      pickedUp ? `The shipper knows it’s on your truck. Deliver to ${place(load.destination)}.` : 'Find a backhaul while you’re there.',
    );
    onDone(updated);
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        block={block}
        className={className}
        icon={pickedUp ? 'truck' : 'check'}
        onClick={() => {
          action.reset();
          setConfirming(true);
        }}
      >
        {pickedUp ? 'Picked up' : 'Delivered'}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={pickedUp ? 'Mark as picked up?' : 'Mark as delivered?'}
        message={
          pickedUp
            ? `Confirm the freight for ${lane(load.origin, load.destination)} is loaded and secured on your truck.`
            : `Only mark it delivered once the freight is off your truck in ${place(load.destination)} and signed for.`
        }
        confirmLabel={pickedUp ? 'Yes, picked up' : 'Yes, delivered'}
        pending={action.pending}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirming(false)}
      >
        {action.error ? (
          <InlineAlert tone="bad" title="Couldn’t update the load">
            {errorMessage(action.error)}
          </InlineAlert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

/** Withdraw a pending request, or give back a booked load before pickup. */
export function WithdrawButton({
  booking,
  load,
  onDone,
  size = 'md',
  block,
  variant = 'secondary',
  className,
}: CommonProps & { booking: Booking; load: Load; onDone: (booking: Booking) => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const action = useAction(() => api.bookings.withdraw(booking.id));
  const givingBack = booking.status === 'accepted';
  if (booking.status !== 'pending' && !(givingBack && load.status === 'booked')) return null;

  const confirm = async () => {
    const updated = await action.run();
    if (!updated) return;
    setConfirming(false);
    toast.success(givingBack ? 'Load given back' : 'Request withdrawn', givingBack ? 'It’s back on the board for other drivers.' : undefined);
    onDone(updated);
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        block={block}
        className={className}
        icon="x"
        onClick={() => {
          action.reset();
          setConfirming(true);
        }}
      >
        {givingBack ? 'Give load back' : 'Withdraw request'}
      </Button>
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={givingBack ? 'Give this load back?' : 'Withdraw your request?'}
        message={
          givingBack
            ? 'The load goes back on the board and the shipper is told you can’t haul it. Dropping booked loads hurts your standing with shippers.'
            : 'The shipper won’t see your request anymore. You can send a new one while the load is open.'
        }
        confirmLabel={givingBack ? 'Give it back' : 'Withdraw'}
        cancelLabel="Keep it"
        pending={action.pending}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirming(false)}
      >
        {action.error ? (
          <InlineAlert tone="bad" title="Couldn’t withdraw">
            {errorMessage(action.error)}
          </InlineAlert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
