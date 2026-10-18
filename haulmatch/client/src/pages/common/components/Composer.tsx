import { useId, useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../lib/cx';

/** Matches the server's message body limit. */
export const MAX_MESSAGE_LENGTH = 2000;
/** Show the character counter once a message gets this close to the limit. */
const COUNT_FROM = MAX_MESSAGE_LENGTH - 200;
/** The box grows with the text up to about six lines, then scrolls. */
const MAX_HEIGHT_PX = 160;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
  /** Who the message goes to, for the label ("Message Marcus Bell"). */
  recipient: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({ value, onChange, onSend, sending, error, recipient, textareaRef }: ComposerProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const empty = value.trim().length === 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value, textareaRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an IME is composing (e.g. picking a suggestion) must not send.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!sending && !empty) onSend();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!sending && !empty) onSend();
  };

  return (
    <form className="cm-composer" onSubmit={onSubmit} aria-busy={sending || undefined}>
      <div className="cm-composer__row">
        <label htmlFor={id} className="visually-hidden">
          Message {recipient}
        </label>
        <textarea
          ref={textareaRef}
          id={id}
          className={cx('input', 'cm-composer__input')}
          rows={1}
          value={value}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Write a message…"
          readOnly={sending}
          enterKeyHint="send"
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? errorId : '', hintId].filter(Boolean).join(' ')}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          icon="send"
          size="lg"
          className="cm-composer__send"
          loading={sending}
          disabled={empty}
          aria-label={sending ? 'Sending message' : 'Send message'}
        />
      </div>
      <div className="cm-composer__meta">
        {error ? (
          <p className="field__error cm-composer__error" id={errorId} role="alert">
            <Icon name="warning" size={16} />
            <span>{error}</span>
          </p>
        ) : null}
        <p className="cm-composer__hint" id={hintId}>
          <span className="hide-mobile">Enter to send · Shift+Enter for a new line</span>
          {value.length >= COUNT_FROM ? (
            <span className={cx('num', value.length >= MAX_MESSAGE_LENGTH && 'text-bad')}>
              {' '}
              {value.length} / {MAX_MESSAGE_LENGTH}
            </span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
