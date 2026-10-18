/**
 * Every mutating API request (POST/PUT/PATCH/DELETE) must carry this header. Browsers cannot
 * add a custom header to a cross-site request without a CORS preflight, which the API never
 * grants, so this blocks CSRF without tokens.
 */
export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'HaulMatch';

export const SESSION_COOKIE = 'hm_session';
export const SESSION_TTL_DAYS = 30;
