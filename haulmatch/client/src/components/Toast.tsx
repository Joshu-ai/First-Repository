import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** Optional client route to open from the toast. */
  link?: { to: string; label?: string };
  /** Auto-dismiss delay. Defaults to 5s (8s for errors). 0 keeps it until dismissed. */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

export interface ToastApi {
  /** Show a toast; returns its id. */
  show: (toast: ToastInput) => number;
  success: (title: string, body?: string) => number;
  error: (title: string, body?: string) => number;
  info: (title: string, body?: string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'bell',
  success: 'check',
  warning: 'warning',
  error: 'warning',
};

const MAX_VISIBLE = 4;

/** Renders the toast stack. Must sit inside the router (toasts can contain links). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { ...toast, id, tone: toast.tone ?? 'info' }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const value = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, body) => show({ title, body, tone: 'success' }),
      error: (title, body) => show({ title, body, tone: 'error' }),
      info: (title, body) => show({ title, body, tone: 'info' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-relevant="additions" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = toast.durationMs ?? (toast.tone === 'error' ? 8000 : 5000);

  useEffect(() => {
    if (paused || duration === 0) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [paused, duration, onDismiss]);

  return (
    <div
      className={cx('toast', `toast--${toast.tone}`)}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        <Icon name={TONE_ICON[toast.tone]} size={18} />
      </span>
      <div className="toast__content">
        <p className="toast__title">{toast.title}</p>
        {toast.body ? <p className="toast__body">{toast.body}</p> : null}
        {toast.link ? (
          <Link className="toast__link" to={toast.link.to} onClick={onDismiss}>
            {toast.link.label ?? 'Open'}
          </Link>
        ) : null}
      </div>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
