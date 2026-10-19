import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, onUnauthorized } from '../../client/src/lib/api';

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[];
let respond: () => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const last = () => calls[calls.length - 1];
const headers = (call: Call) => call.init.headers as Record<string, string>;

beforeEach(() => {
  calls = [];
  respond = () => new Response(null, { status: 204 });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client api transport', () => {
  it('sends GETs without the CSRF header and serializes the query', async () => {
    respond = () => json({ loads: [], total: 0, driverProfileComplete: true });
    await api.loads.list({ equipment: ['HS_GOOSENECK'], hazmat: false, limit: 20, offset: 40 });
    expect(last().url).toBe('/api/loads?equipment=HS_GOOSENECK&hazmat=false&limit=20&offset=40');
    expect(headers(last())['X-Requested-With']).toBeUndefined();
    expect(last().init.credentials).toBe('same-origin');
  });

  it('sends mutations with the CSRF header and a JSON body, encoding ids', async () => {
    respond = () => json({ booking: {}, load: {} }, 201);
    await api.loads.book('a/b', { offerRateUsd: 1500 });
    expect(last().url).toBe('/api/loads/a%2Fb/book');
    expect(last().init.method).toBe('POST');
    expect(headers(last())['X-Requested-With']).toBe('HaulMatch');
    expect(last().init.body).toBe(JSON.stringify({ offerRateUsd: 1500 }));

    await api.savedSearches.remove('s1');
    expect(last().init.method).toBe('DELETE');
    expect(headers(last())['X-Requested-With']).toBe('HaulMatch');
  });

  it('resolves 204 responses with undefined', async () => {
    await expect(api.auth.logout()).resolves.toBeUndefined();
    expect(last().init.body).toBe('{}');
  });

  it('turns error bodies into ApiError and tells listeners about 401s only', async () => {
    let fired = 0;
    const off = onUnauthorized(() => {
      fired += 1;
    });
    respond = () => json({ error: { code: 'unauthorized', message: 'Sign in to continue' } }, 401);
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fired).toBe(1);

    respond = () => json({ error: { code: 'not_eligible', message: 'Not eligible', details: [{ key: 'weight' }] } }, 422);
    const err = await api.loads.book('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'not_eligible', details: [{ key: 'weight' }] });
    expect(fired).toBe(1);
    off();
  });

  it('handles non-JSON responses and network failures', async () => {
    respond = () => new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'text/html' } });
    await expect(api.meta.get()).rejects.toMatchObject({ status: 502, code: 'http_error' });

    respond = () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    await expect(api.meta.get()).rejects.toMatchObject({ code: 'bad_response' });

    respond = () => {
      throw new TypeError('Failed to fetch');
    };
    const err = await api.meta.get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isNetwork).toBe(true);
    expect(errorMessage(err)).toMatch(/^Can’t reach HaulMatch/);
  });
});

describe('client api endpoint shapes', () => {
  it('builds the URLs and bodies docs/SPEC.md defines', async () => {
    respond = () => json({ unreadCount: 0 });
    await api.notifications.markRead();
    expect(last().init.body).toBe('{}');
    await api.notifications.markRead(['n1']);
    expect(last().init.body).toBe(JSON.stringify({ ids: ['n1'] }));

    respond = () => json([]);
    await api.notifications.list({ unread: true, limit: 1 });
    expect(last().url).toBe('/api/notifications?unread=1&limit=1');
    await api.meta.rateEstimate({ originCityId: 'houston-tx', destinationCityId: 'odessa-tx', equipment: ['HS_GOOSENECK', 'FLATBED'] });
    expect(last().url).toBe('/api/rates/estimate?originCityId=houston-tx&destinationCityId=odessa-tx&equipment=HS_GOOSENECK%2CFLATBED');
    await api.meta.rateEstimate({
      originCityId: 'houston-tx',
      destinationCityId: 'odessa-tx',
      equipment: ['FLATBED', 'HS_GOOSENECK'],
      weightLbs: 45_000,
      lengthFt: 45,
    });
    expect(last().url).toBe(
      '/api/rates/estimate?originCityId=houston-tx&destinationCityId=odessa-tx&equipment=FLATBED%2CHS_GOOSENECK&weightLbs=45000&lengthFt=45',
    );
    await api.meta.rateEstimate({ originCityId: 'houston-tx', destinationCityId: 'odessa-tx', equipment: [], weightLbs: null, lengthFt: null });
    expect(last().url).toBe('/api/rates/estimate?originCityId=houston-tx&destinationCityId=odessa-tx');
    await api.messages.list('l1');
    expect(last().url).toBe('/api/loads/l1/messages');
    await api.messages.list('l1', 'd1');
    expect(last().url).toBe('/api/loads/l1/messages?driverId=d1');
    // Paging: the newest page, then the one before the oldest message shown.
    await api.messages.list('l1', undefined, { limit: 100 });
    expect(last().url).toBe('/api/loads/l1/messages?limit=100');
    await api.messages.list('l1', 'd1', { before: 'm 1', limit: 100 });
    expect(last().url).toBe('/api/loads/l1/messages?driverId=d1&before=m+1&limit=100');
    expect(last().init.method).toBe('GET');
    // Marking read is its own POST (a GET marks nothing read).
    await api.messages.markRead('l1', 'd1');
    expect(last().url).toBe('/api/loads/l1/messages/read');
    expect(last().init.method).toBe('POST');
    expect(headers(last())['X-Requested-With']).toBe('HaulMatch');
    expect(last().init.body).toBe(JSON.stringify({ driverId: 'd1' }));
    await api.shipper.loads('active');
    expect(last().url).toBe('/api/shipper/loads?status=active');
    await api.bookings.list();
    expect(last().url).toBe('/api/bookings');
    await api.bookings.accept('b1');
    expect(last().url).toBe('/api/bookings/b1/accept');
    await api.meta.searchCities('dal', 5);
    expect(last().url).toBe('/api/cities?q=dal&limit=5');
    await api.loads.setStatus('l1', 'in_transit');
    expect(last().url).toBe('/api/loads/l1/status');
    expect(last().init.body).toBe(JSON.stringify({ status: 'in_transit' }));
    await api.drivers.updateMyProfile({ currentCityId: null });
    expect(last().init.method).toBe('PUT');
    expect(last().init.body).toBe('{"currentCityId":null}');
    await api.drivers.updateMyLocation({ cityId: 'tulsa-ok' });
    expect(last().init.method).toBe('PATCH');
    expect(last().url).toBe('/api/drivers/me/location');
  });
});
