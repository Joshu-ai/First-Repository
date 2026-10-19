import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from '../lib/cx';
import { focusPageHeading, rescueFocus } from '../lib/focusKeeper';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  /** Called on Escape, the close button, or a backdrop tap (unless `dismissible` is false). */
  onClose: () => void;
  title: ReactNode;
  /** Short line under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons). Rendered sticky at the bottom on phones. */
  footer?: ReactNode;
  /** sm = 420px, md = 560px (default), lg = 760px. Phones always get a bottom sheet. */
  size?: 'sm' | 'md' | 'lg';
  /** Set false while a request is in flight so the dialog cannot be closed mid-save. Default true. */
  dismissible?: boolean;
  /** Element to focus when the dialog opens (defaults to the first focusable field or button). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog on the native <dialog> element: the page behind is inert, Escape closes,
 * focus is trapped inside and returns to the opener on close (or, when the opener is gone, to what
 * now sits in its place: see lib/focusKeeper.ts).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  initialFocusRef,
  className,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const body = dialog.querySelector('.modal__body');
      const target =
        initialFocusRef?.current ??
        body?.querySelector<HTMLElement>(FOCUSABLE) ??
        dialog.querySelector<HTMLElement>('.modal__footer button') ??
        dialog.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
      // The action may have removed the button that opened the dialog (an accepted request's row, a
      // withdrawn trip), or turned it off: focus what now sits there instead of dropping to <body>.
      if (back && document.activeElement !== back && !rescueFocus()) focusPageHeading();
    }
  }, [open, initialFocusRef]);

  // Closing the page while a dialog is open must not leave the document inert.
  useEffect(() => () => ref.current?.close(), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={cx('modal', `modal--${size}`, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        // Escape: let React state drive closing so `open` stays the source of truth.
        e.preventDefault();
        if (dismissibleRef.current) onCloseRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissibleRef.current) onCloseRef.current();
      }}
      onKeyDown={onKeyDown}
    >
      {open ? (
        <div className="modal__panel">
          <header className="modal__header">
            <div>
              <h2 className="modal__title" id={titleId}>
                {title}
              </h2>
              {description ? (
                <p className="modal__description" id={descId}>
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" className="modal__close" onClick={onClose} aria-label="Close" disabled={!dismissible}>
              <Icon name="x" size={20} />
            </button>
          </header>
          {children ? <div className="modal__body">{children}</div> : null}
          {footer ? <footer className="modal__footer">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** What will happen, in plain words. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red confirm button (cancel a load, withdraw a request). */
  tone?: 'primary' | 'danger';
  /** Spinner on the confirm button and the dialog cannot be dismissed. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content (e.g. an error message from the failed attempt). */
  children?: ReactNode;
}

/** Yes/no confirmation built on Modal. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Never mind',
  tone = 'primary',
  pending,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
