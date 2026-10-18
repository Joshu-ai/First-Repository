import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import type { DriverClass, Role } from '../../../../shared/types';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InlineAlert, PageLoader } from '../../components/Feedback';
import { PasswordInput, RadioCards, TextInput, type RadioCardOption } from '../../components/Form';
import { ApiError, errorMessage, type RegisterInput } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { homePathFor, paths } from '../../lib/routes';
import { HotshotArt, SemiArt, ShipperArt } from './illustrations';

type Seat = 'hotshot' | 'semi' | 'shipper';

const SEAT_OPTIONS: RadioCardOption<Seat>[] = [
  {
    value: 'hotshot',
    title: 'I run hotshot',
    description: 'Pickup with a gooseneck, bumper pull, dovetail or car hauler.',
    media: <HotshotArt height={44} />,
  },
  {
    value: 'semi',
    title: 'I drive a semi',
    description: 'Tractor-trailer: van, reefer, flatbed, step deck, RGN and more.',
    media: <SemiArt height={44} />,
  },
  {
    value: 'shipper',
    title: 'I ship freight',
    description: 'Shippers and brokers posting loads for carriers.',
    media: <ShipperArt height={44} />,
  },
];

function seatFromParams(params: URLSearchParams): Seat | null {
  const role = params.get('role');
  if (role === 'shipper') return 'shipper';
  const driverClass = params.get('class');
  if (driverClass === 'hotshot' || driverClass === 'semi') return driverClass;
  return null;
}

function seatToRole(seat: Seat): { role: Role; driverClass?: DriverClass } {
  return seat === 'shipper' ? { role: 'shipper' } : { role: 'driver', driverClass: seat };
}

type FieldName = 'seat' | 'name' | 'email' | 'password' | 'company' | 'phone';
type Errors = Partial<Record<FieldName, string>>;

interface Values {
  name: string;
  email: string;
  password: string;
  company: string;
  phone: string;
}

function validate(seat: Seat | null, v: Values): Errors {
  const errors: Errors = {};
  if (!seat) errors.seat = 'Pick how you will use HaulMatch';
  if (!v.name.trim()) errors.name = 'Enter your name';
  else if (v.name.trim().length > 80) errors.name = 'Keep it under 80 characters';
  if (!v.email.trim()) errors.email = 'Enter your email';
  else if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) errors.email = 'That doesn’t look like an email address';
  if (v.password.length < 8) errors.password = 'Use at least 8 characters';
  else if (v.password.length > 200) errors.password = 'Keep it under 200 characters';
  if (v.company.trim().length > 120) errors.company = 'Keep it under 120 characters';
  if (v.phone && !/^[\d\s()+.-]{7,20}$/.test(v.phone.trim())) errors.phone = 'Enter a phone number like 432-555-0142';
  return errors;
}

/** Maps API field paths (e.g. "driverClass") onto this form's fields. */
function apiErrorsToFields(err: ApiError): Errors {
  const fields = err.fieldErrors();
  const out: Errors = {};
  for (const [path, message] of Object.entries(fields)) {
    const key = path === 'role' || path === 'driverClass' ? 'seat' : (path as FieldName);
    if (['seat', 'name', 'email', 'password', 'company', 'phone'].includes(key)) out[key] = message;
  }
  return out;
}

export default function Signup() {
  useDocumentTitle('Create your account');
  const { user, driverProfile, loading, register } = useAuth();
  const [params, setParams] = useSearchParams();
  const [seat, setSeat] = useState<Seat | null>(() => seatFromParams(params));
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '', company: '', phone: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);

  if (loading) return <PageLoader />;
  // Just registered (or already signed in): drivers land on setup, shippers on the dashboard.
  if (user) return <Navigate to={homePathFor(user, driverProfile)} replace />;

  const set = (field: keyof Values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const chooseSeat = (next: Seat) => {
    setSeat(next);
    setErrors((prev) => ({ ...prev, seat: undefined }));
    const { role, driverClass } = seatToRole(next);
    const nextParams = new URLSearchParams(params);
    nextParams.set('role', role);
    if (driverClass) nextParams.set('class', driverClass);
    else nextParams.delete('class');
    setParams(nextParams, { replace: true });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate(seat, values);
    setErrors(found);
    setFormError(null);
    if (Object.values(found).some(Boolean) || !seat) {
      // Wait for the error state to render, then put the cursor on the first problem.
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.radio-cards.field--invalid input, [aria-invalid="true"]')?.focus();
      });
      return;
    }
    const { role, driverClass } = seatToRole(seat);
    const input: RegisterInput = {
      email: values.email.trim(),
      password: values.password,
      name: values.name.trim(),
      role,
      driverClass,
      company: values.company.trim() || undefined,
      phone: values.phone.trim() || undefined,
    };
    setSubmitting(true);
    setEmailTaken(false);
    try {
      await register(input);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        const fieldErrors = apiErrorsToFields(err);
        setErrors(fieldErrors);
        setEmailTaken(err.code === 'email_taken');
        if (Object.keys(fieldErrors).length === 0) setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    }
  };

  const isDriver = seat === 'hotshot' || seat === 'semi';

  return (
    <div className="auth">
      <div className="auth__panel auth__panel--wide">
        <div className="auth__head">
          <h1>Create your free account</h1>
          <p className="muted">Two minutes now saves a lot of dead calls later.</p>
        </div>

        <form className="stack-lg" onSubmit={onSubmit} noValidate>
          <RadioCards
            label="How will you use HaulMatch?"
            options={SEAT_OPTIONS}
            value={seat}
            onChange={chooseSeat}
            error={errors.seat}
            size="lg"
            columns={3}
          />

          <Card>
            <div className="form">
              <h2 className="section-title">Your details</h2>
              {formError ? (
                <InlineAlert tone="bad" title="Couldn’t create your account">
                  {formError}
                </InlineAlert>
              ) : null}
              {emailTaken ? (
                <InlineAlert tone="info" title="Already have an account?">
                  <Link to={paths.login()}>Log in instead</Link>
                </InlineAlert>
              ) : null}
              <div className="form-row">
                <TextInput
                  label="Your name"
                  autoComplete="name"
                  value={values.name}
                  onChange={set('name')}
                  error={errors.name}
                  required
                />
                <TextInput
                  label="Email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values.email}
                  onChange={set('email')}
                  error={errors.email}
                  required
                />
              </div>
              <PasswordInput
                label="Password"
                autoComplete="new-password"
                value={values.password}
                onChange={set('password')}
                error={errors.password}
                hint="At least 8 characters."
                required
              />
              <div className="form-row">
                <TextInput
                  label={isDriver ? 'Carrier or company name' : seat === 'shipper' ? 'Company or brokerage' : 'Company'}
                  autoComplete="organization"
                  value={values.company}
                  onChange={set('company')}
                  error={errors.company}
                  optional
                />
                <TextInput
                  label="Phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={values.phone}
                  onChange={set('phone')}
                  error={errors.phone}
                  optional
                  hint={
                    isDriver
                      ? 'Only shown to shippers you are booked or talking with.'
                      : 'So drivers on your loads can reach you.'
                  }
                />
              </div>
              {isDriver ? (
                <p className="muted text-sm">
                  Next, you’ll add your rig: equipment, deck length, payload and where you’re empty.
                </p>
              ) : null}
              <Button type="submit" size="lg" block loading={submitting}>
                Create account
              </Button>
            </div>
          </Card>
        </form>

        <p className="auth__switch">
          Already on HaulMatch? <Link to={paths.login()}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
