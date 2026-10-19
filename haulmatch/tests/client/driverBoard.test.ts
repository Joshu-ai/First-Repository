import { describe, expect, it } from 'vitest';
import { cityEnterAction } from '../../client/src/components/CityInput';
import { cityForId, cityFromId, rememberCity } from '../../client/src/pages/driver/components/cities';
import { draftFromFilters, filtersFromDraft } from '../../client/src/pages/driver/components/filterDraft';
import { appendPage, loadMorePage, PAGE_SIZE } from '../../client/src/pages/driver/components/useLoadBoard';
import type { City, LoadWithMatch } from '../../shared/types';

const midland: City = { id: 'midland-tx', name: 'Midland', state: 'TX', lat: 31.997, lng: -102.078 };

describe('cityForId (useCity answers for the id of this render)', () => {
  it('never hands back the city of the previous id, or none, while the new one loads', () => {
    expect(cityForId(null, midland)).toBeNull();
    expect(cityForId(undefined, null)).toBeNull();
    expect(cityForId('midland-tx', midland)).toBe(midland);
    // The id just changed and the hook still holds the old city (or nothing): a stand-in for the new id.
    expect(cityForId('abilene-tx', midland)).toEqual(cityFromId('abilene-tx'));
    expect(cityForId('abilene-tx', null)?.id).toBe('abilene-tx');
  });

  it('uses the remembered record when there is one', () => {
    const lubbock: City = { id: 'lubbock-tx', name: 'Lubbock', state: 'TX', lat: 33.58, lng: -101.86 };
    rememberCity(lubbock);
    expect(cityForId('lubbock-tx', midland)).toBe(lubbock);
  });

  it('keeps "Pickup near" in a filter draft built on the render the city id changed', () => {
    // The desktop filter panel remounts after Apply and builds its draft from useCity right away;
    // the Edit alert dialog does the same when it opens. Both used to get null here and dropped the city.
    const filters = { originCityId: 'midland-tx', originRadiusMiles: 150, minRatePerMile: 2 };
    const draft = draftFromFilters(filters, cityForId(filters.originCityId, null));
    expect(draft.originCity?.id).toBe('midland-tx');
    expect(filtersFromDraft({ ...draft, maxWeightLbs: 20000 })).toEqual({ ...filters, maxWeightLbs: 20000 });

    // Switching Midland -> Abilene: the panel must not show (and re-apply) Midland.
    const next = { originCityId: 'abilene-tx', originRadiusMiles: 100 };
    expect(filtersFromDraft(draftFromFilters(next, cityForId(next.originCityId, midland)))).toEqual(next);
  });
});

describe('Load more on a live board', () => {
  const load = (i: number) => ({ id: `l${i}` }) as LoadWithMatch;
  const board = Array.from({ length: 30 }, (_, i) => load(i + 1));

  it('re-reads from the top up to the API limit, then pages on by offset', () => {
    expect(loadMorePage(20)).toEqual({ offset: 0, limit: 20 + PAGE_SIZE, replace: true });
    expect(loadMorePage(190)).toEqual({ offset: 0, limit: 200, replace: true });
    expect(loadMorePage(200)).toEqual({ offset: 200, limit: PAGE_SIZE, replace: false });
  });

  it('shows every load still on the board after one on page one left it', () => {
    const shown = board.slice(0, 20);
    // The shipper of card #4 cancels it; this driver gets no event, so the screen still shows it.
    const live = board.filter((l) => l.id !== 'l4');
    const page = loadMorePage(shown.length);
    const res = live.slice(page.offset, page.offset + page.limit);
    const next = page.replace ? res : appendPage(shown, res);
    expect(next.map((l) => l.id)).toEqual(live.map((l) => l.id));

    // The old request (offset = cards shown) started one load too late: l21 was never shown.
    const old = appendPage(shown, live.slice(shown.length, shown.length + PAGE_SIZE));
    expect(old.map((l) => l.id)).not.toContain('l21');
  });

  it('skips loads already shown when paging by offset', () => {
    expect(appendPage([load(1), load(2)], [load(2), load(3)]).map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
  });
});

describe('CityInput: Enter', () => {
  const base = { dirty: true, text: 'San Diego', resultsFor: 'San Diego', hasActive: true };

  it('picks the highlighted suggestion only when it was found for the text in the box', () => {
    expect(cityEnterAction(base)).toBe('choose');
    // Typed " Diego" fast after the suggestions for "San" (San Antonio first) came back.
    expect(cityEnterAction({ ...base, resultsFor: 'San' })).toBe('wait');
    expect(cityEnterAction({ ...base, resultsFor: null })).toBe('wait');
    expect(cityEnterAction({ ...base, text: '  San Diego ' })).toBe('choose');
  });

  it('never submits the form with half-typed text, and lets Enter through otherwise', () => {
    expect(cityEnterAction({ ...base, hasActive: false })).toBe('ignore');
    expect(cityEnterAction({ ...base, text: 'S', resultsFor: null })).toBe('ignore');
    expect(cityEnterAction({ ...base, dirty: false })).toBe('pass');
    expect(cityEnterAction({ ...base, text: '   ' })).toBe('pass');
  });
});
