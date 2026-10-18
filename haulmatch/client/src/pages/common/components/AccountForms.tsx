import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '../../../../../shared/types';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { InlineAlert } from '../../../components/Feedback';
import { PasswordInput, TextInput } from '../../../components/Form';
import { useToast } from '../../../components/Toast';
import { api, errorMessage, isApiError, type ChangePasswordInput } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useAction } from '../../../lib/hooks';

type Errors = Record<string, string>;

/** Same rules as the server (routes/auth.ts) so most mistakes are caught before a round trip. */
const PHONE_PATTERN = /^\+?[0-9 ().-]{7,}$/;
const NAME_MAX = 80;
const COMPANY_MAX = 120;
const PHONE_MAX = 30;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

/**
 * Field errors to show: local checks first, then the server's for fields it named.
 * `general` is the server message when it did not point at a field the form shows.
 */
function serverErrors(error: unknown, fields: string[]): { fieldErrors: Errors; general: string | null } {
  if (!error) return { fieldErrors: {}, general: null };
  const fieldErrors = isApiError(error) ? error.fieldErrors() : {};
  const known = fields.some((f) => fieldErrors[f]);
  return { fieldErrors, general: known ? null : errorMessage(error) };
}

/** Move focus to the first invalid field after a failed save, so keyboard and screen reader users land on it. */
function useFocusFirstInvalid(trigger: unknown) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!trigger) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [trigger]);
  return formRef;
}

// ---------------------------------------------------------------------------
// Name, company, phone
// ---------------------------------------------------------------------------

interface DetailsDraft {
  name: string;
  company: string;
  phone: string;
}

const draftFrom = (user: User): DetailsDraft => ({ name: user.name, company: user.company ?? '', phone: user.phone ?? '' });

function validateDetails(d: DetailsDraft): Errors {
  const errors: Errors = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Enter your name';
  else if (name.length > NAME_MAX) errors.name = `Keep it under ${NAME_MAX} characters`;
  if (d.company.trim().length > COMPANY_MAX) errors.company = `Keep it under ${COMPANY_MAX} characters`;
  const phone = d.phone.trim();
  if (phone && (phone.length > PHONE_MAX || !PHONE_PATTERN.test(phone))) errors.phone = 'Enter a valid phone number';
  return errors;
}

export function DetailsCard({ user }: { user: User }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState(() => draftFrom(user));
  const [localErrors, setLocalErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const save = useAction(api.auth.updateMe);
  const server = serverErrors(save.error, ['name', 'company', 'phone']);
  const formRef = useFocusFirstInvalid(attempt);

  const original = draftFrom(user);
  const dirty =
    draft.name.trim() !== original.name || draft.company.trim() !== original.company || draft.phone.trim() !== original.phone;
  const errorFor = (field: keyof DetailsDraft) => localErrors[field] ?? server.fieldErrors[field] ?? null;

  const change = (field: keyof DetailsDraft, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (localErrors[field]) setLocalErrors(({ [field]: _cleared, ...rest }) => rest);
    if (save.error) save.reset();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errors = validateDetails(draft);
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    const res = await save.run({
      name: draft.name.trim(),
      company: draft.company.trim() || null,
      phone: draft.phone.trim() || null,
    });
    if (!res) {
      setAttempt((n) => n + 1);
      return;
    }
    setUser(res.user);
    setDraft(draftFrom(res.user));
    toast.success('Details saved');
  };

  const driver = user.role === 'driver';
  return (
    <Card as="section" title="Your details" subtitle={driver ? 'How shippers see you.' : 'How drivers see you and your loads.'}>
      <form ref={formRef} className="form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="cm-static-field">
          <span className="field__label">Email</span>
          <span className="cm-static-field__value">{user.email}</span>
          <span className="field__hint">You sign in with this. It can’t be changed here.</span>
        </div>
        <TextInput
          label="Your name"
          value={draft.name}
          onChange={(e) => change('name', e.target.value)}
          error={errorFor('name')}
          autoComplete="name"
          maxLength={NAME_MAX}
          required
        />
        <TextInput
          label={driver ? 'Carrier or company name' : 'Company or brokerage'}
          value={draft.company}
          onChange={(e) => change('company', e.target.value)}
          error={errorFor('company')}
          autoComplete="organization"
          maxLength={COMPANY_MAX}
          optional
          hint={driver ? 'Leave blank if you run under your own name.' : 'Shown on every load you post.'}
        />
        <TextInput
          label="Phone"
          type="tel"
          inputMode="tel"
          value={draft.phone}
          onChange={(e) => change('phone', e.target.value)}
          error={errorFor('phone')}
          autoComplete="tel"
          maxLength={PHONE_MAX}
          optional
          hint={
            driver
              ? 'Only shippers you’re booked with, requesting or messaging can see it.'
              : 'Drivers on your loads use this to call about pickup and delivery.'
          }
        />
        {server.general ? (
          <InlineAlert tone="bad" title="Couldn’t save your details">
            {server.general}
          </InlineAlert>
        ) : null}
        <div className="cm-form-actions">
          <Button type="submit" loading={save.pending} disabled={!dirty}>
            Save changes
          </Button>
          {dirty && !save.pending ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(original);
                setLocalErrors({});
                save.reset();
              }}
            >
              Undo changes
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

interface PasswordDraft {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_PASSWORDS: PasswordDraft = { currentPassword: '', newPassword: '', confirmPassword: '' };

function validatePasswords(d: PasswordDraft): Errors {
  const errors: Errors = {};
  if (!d.currentPassword) errors.currentPassword = 'Enter your current password';
  if (d.newPassword.length < PASSWORD_MIN) errors.newPassword = `Use at least ${PASSWORD_MIN} characters`;
  else if (d.newPassword.length > PASSWORD_MAX) errors.newPassword = `Keep it under ${PASSWORD_MAX} characters`;
  else if (d.newPassword === d.currentPassword) errors.newPassword = 'Pick a password different from your current one';
  if (!errors.newPassword && d.confirmPassword !== d.newPassword) errors.confirmPassword = 'The two new passwords don’t match';
  return errors;
}

export function PasswordCard({ email }: { email: string }) {
  const toast = useToast();
  const [draft, setDraft] = useState<PasswordDraft>(EMPTY_PASSWORDS);
  const [localErrors, setLocalErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  // POST /auth/password answers 204; resolve true so success is distinguishable from a failure.
  const change = useAction((input: ChangePasswordInput) => api.auth.changePassword(input).then(() => true));
  const server = serverErrors(change.error, ['currentPassword', 'newPassword']);
  const formRef = useFocusFirstInvalid(attempt);
  const errorFor = (field: keyof PasswordDraft) => localErrors[field] ?? server.fieldErrors[field] ?? null;
  const started = draft.currentPassword || draft.newPassword || draft.confirmPassword;

  const update = (field: keyof PasswordDraft, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (localErrors[field]) setLocalErrors(({ [field]: _cleared, ...rest }) => rest);
    if (change.error) change.reset();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errors = validatePasswords(draft);
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    const ok = await change.run({ currentPassword: draft.currentPassword, newPassword: draft.newPassword });
    if (!ok) {
      setAttempt((n) => n + 1);
      return;
    }
    setDraft(EMPTY_PASSWORDS);
    toast.success('Password changed', 'Any other phones or computers signed in to your account were signed out.');
  };

  return (
    <Card as="section" title="Change password" subtitle="Changing it signs you out everywhere else.">
      <form ref={formRef} className="form" onSubmit={(e) => void submit(e)} noValidate>
        <input
          className="cm-hidden-username"
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <PasswordInput
          label="Current password"
          value={draft.currentPassword}
          onChange={(e) => update('currentPassword', e.target.value)}
          error={errorFor('currentPassword')}
          autoComplete="current-password"
          required
        />
        <PasswordInput
          label="New password"
          value={draft.newPassword}
          onChange={(e) => update('newPassword', e.target.value)}
          error={errorFor('newPassword')}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          maxLength={PASSWORD_MAX}
          required
        />
        <PasswordInput
          label="Confirm new password"
          value={draft.confirmPassword}
          onChange={(e) => update('confirmPassword', e.target.value)}
          error={errorFor('confirmPassword')}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          required
        />
        {server.general ? (
          <InlineAlert tone="bad" title="Couldn’t change your password">
            {server.general}
          </InlineAlert>
        ) : null}
        <div className="cm-form-actions">
          <Button type="submit" variant="secondary" icon="shield" loading={change.pending} disabled={!started}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
