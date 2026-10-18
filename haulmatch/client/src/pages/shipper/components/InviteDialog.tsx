import { useEffect, useState } from 'react';
import type { DriverSummary } from '../../../../../shared/types';
import { Button } from '../../../components/Button';
import { InlineAlert } from '../../../components/Feedback';
import { TextArea } from '../../../components/Form';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { api, errorMessage, isApiError } from '../../../lib/api';

const NOTE_MAX = 500;

export interface InviteDialogProps {
  loadId: string;
  /** The driver to invite; null keeps the dialog closed. */
  driver: DriverSummary | null;
  onClose: () => void;
  /** Called after the invite went out. */
  onInvited: (driverId: string) => void;
}

/** "Invite to book": pings a recommended driver with a link to the load and an optional note. */
export function InviteDialog({ loadId, driver, onClose, onInvited }: InviteDialogProps) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const driverId = driver?.userId ?? null;

  useEffect(() => {
    setNote('');
    setNoteError(null);
    setError(null);
  }, [driverId]);

  if (!driver) return <Modal open={false} onClose={onClose} title="" />;
  const first = driver.name.split(' ')[0];

  const send = async () => {
    const trimmed = note.trim();
    if (trimmed.length > NOTE_MAX) {
      setNoteError(`Keep it under ${NOTE_MAX} characters`);
      return;
    }
    setSending(true);
    setError(null);
    setNoteError(null);
    try {
      await api.loads.invite(loadId, { driverId: driver.userId, message: trimmed || undefined });
      toast.success(`Invite sent to ${first}`, 'They got a notification with a link to book this load.');
      onInvited(driver.userId);
      onClose();
    } catch (err) {
      const field = isApiError(err) ? err.fieldErrors().message : undefined;
      if (field) setNoteError(field);
      else setError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!sending}
      title={`Invite ${driver.name} to book`}
      description={`${first} gets a notification with a link to this load. Add a note if it helps them say yes.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button icon="send" loading={sending} onClick={() => void send()}>
            Send invite
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? (
          <InlineAlert tone="bad" title="Invite didn’t go out">
            {errorMessage(error)}
          </InlineAlert>
        ) : null}
        <TextArea
          label="Note to the driver"
          optional
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (noteError) setNoteError(null);
          }}
          error={noteError}
          placeholder="Dock opens at 7. Straps and chains needed, no tarp."
        />
      </div>
    </Modal>
  );
}
