import { ButtonLink } from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/hooks';
import { homePathFor, paths } from '../../lib/routes';

export default function NotFound() {
  useDocumentTitle('Page not found');
  const { user, driverProfile } = useAuth();
  const home = user ? homePathFor(user, driverProfile) : paths.home;
  const secondary =
    user?.role === 'driver'
      ? { to: paths.driverLoads, label: 'Find loads' }
      : user?.role === 'shipper'
        ? { to: paths.shipperNewLoad, label: 'Post a load' }
        : { to: paths.login(), label: 'Log in' };

  return (
    <div className="container">
      <div className="not-found">
        <p className="not-found__code" aria-hidden="true">
          404
        </p>
        <h1>This road doesn’t go anywhere</h1>
        <p className="muted prose">
          The page you were headed for moved, expired or never existed. Let’s get you back on the route.
        </p>
        <div className="row row-center">
          <ButtonLink to={home} icon="home">
            {user ? 'Back to my board' : 'Go to the home page'}
          </ButtonLink>
          <ButtonLink to={secondary.to} variant="secondary">
            {secondary.label}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
