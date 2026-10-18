import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InlineAlert, PageLoader } from '../../components/Feedback';
import { PasswordInput, TextInput } from '../../components/Form';
import { Icon, type IconName } from '../../components/Icon';
import { ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { homePathFor, paths, safeNextPath } from '../../lib/routes';

/** Demo logins from docs/SPEC.md (seeded by server/seed.ts). */
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS: { email: string; title: string; detail: string; icon: IconName }[] = [
  { email: 'hotshot@demo.haulmatch.app', title: 'Hotshot driver', detail: 'Non-CDL, 40 ft gooseneck · Odessa, TX', icon: 'truck' },
  { email: 'semi@demo.haulmatch.app', title: 'Semi driver', detail: 'CDL-A flatbed and step deck · Dallas, TX', icon: 'truck' },
  { email: 'shipper@demo.haulmatch.app', title: 'Shipper', detail: 'Lone Star Oilfield Supply · Houston, TX', icon: 'building' },
];

interface FieldErrors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = 'Enter your email';
  else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'That doesn’t look like an email address';
  if (!password) errors.password = 'Enter your password';
  return errors;
}

export default function Login() {
  useDocumentTitle('Log in');
  const { user, driverProfile, loading, login } = useAuth();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  if (loading) return <PageLoader />;
  // Signed in (already, or just now): go to ?next= or the role home.
  if (user) return <Navigate to={next ?? homePathFor(user, driverProfile)} replace />;

  const signIn = async (emailValue: string, passwordValue: string, source: string) => {
    const found = validate(emailValue, passwordValue);
    setErrors(found);
    setFormError(null);
    if (found.email || found.password) return;
    setSubmitting(source);
    try {
      await login(emailValue.trim(), passwordValue);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'invalid_credentials' || err.status === 401)) {
        setFormError('That email and password don’t match. Check for typos and try again.');
      } else if (err instanceof ApiError && err.code === 'validation_error') {
        const fields = err.fieldErrors();
        setErrors({ email: fields.email, password: fields.password });
        if (!fields.email && !fields.password) setFormError(err.message);
      } else {
        setFormError(errorMessage(err));
      }
      setSubmitting(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email, password, 'form');
  };

  const signInAsDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    void signIn(demoEmail, DEMO_PASSWORD, demoEmail);
  };

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__head">
          <h1>Log in</h1>
          <p className="muted">Welcome back. Your loads, trips and messages are where you left them.</p>
        </div>

        <Card>
          <form className="form" onSubmit={onSubmit} noValidate>
            {formError ? (
              <InlineAlert tone="bad" title="Couldn’t log you in">
                {formError}
              </InlineAlert>
            ) : null}
            <TextInput
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              required
            />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              required
            />
            <Button type="submit" size="lg" block loading={submitting === 'form'} disabled={submitting !== null}>
              Log in
            </Button>
          </form>
        </Card>

        <section className="stack-sm" aria-labelledby="demo-title">
          <p className="or-divider" id="demo-title">
            Or try a demo account
          </p>
          <div className="demo-logins">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="demo-login"
                onClick={() => signInAsDemo(account.email)}
                disabled={submitting !== null}
                aria-busy={submitting === account.email || undefined}
              >
                <span className="demo-login__icon" aria-hidden="true">
                  <Icon name={account.icon} size={20} />
                </span>
                <span className="demo-login__text">
                  <span className="demo-login__title">{account.title}</span>
                  <span className="demo-login__email">{account.detail}</span>
                  <span className="demo-login__email">{account.email}</span>
                </span>
                <Icon name="arrowRight" size={18} />
              </button>
            ))}
          </div>
          <p className="muted text-sm text-center">
            Demo accounts share the password <strong>{DEMO_PASSWORD}</strong>. Tapping one fills it in and signs you in.
          </p>
        </section>

        <p className="auth__switch">
          New to HaulMatch? <Link to={paths.signup()}>Create a free account</Link>
        </p>
      </div>
    </div>
  );
}
