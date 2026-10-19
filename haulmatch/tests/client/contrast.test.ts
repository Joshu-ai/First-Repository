// Contrast of the design tokens in client/src/styles.css, light and dark. Drivers read the app in
// sun glare, so text meets WCAG AA 4.5:1 and the outlines and state marks of controls meet 3:1
// (WCAG 1.4.11) against every surface they sit on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../client/src/styles.css', import.meta.url), 'utf8');

/** The body of the first `{ ... }` block after `start`. */
function block(start: string): string {
  const at = css.indexOf(start);
  if (at < 0) throw new Error(`no ${start} in styles.css`);
  let i = css.indexOf('{', at);
  const from = i + 1;
  for (let depth = 1; depth > 0; ) {
    i++;
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(from, i);
}

function tokens(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = tokens(block(':root {'));
const dark = { ...light, ...tokens(block('@media (prefers-color-scheme: dark)')) };
const themes = { light, dark };

type Rgb = [number, number, number];

/** A token as an opaque colour; a translucent one is laid over `under` (the surface it tints). */
function color(theme: Record<string, string>, name: string, under = 'surface'): Rgb {
  let value = theme[name];
  if (!value) throw new Error(`no --${name}`);
  for (let ref = value.match(/^var\(--([\w-]+)\)$/); ref; ref = value.match(/^var\(--([\w-]+)\)$/)) value = theme[ref[1]];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  const rgba = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
  if (!rgba) throw new Error(`cannot read --${name}: ${value}`);
  const alpha = Number(rgba[4]);
  const base = color(theme, under);
  return [1, 2, 3].map((i, k) => Math.round(alpha * Number(rgba[i]) + (1 - alpha) * base[k])) as Rgb;
}

const literal = (hex: string): Rgb => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3'];

describe.each(Object.entries(themes))('%s theme tokens', (_name, theme) => {
  const c = (name: string, under?: string) => color(theme, name, under);

  it('outlines form controls at 3:1 or more on every surface (inputs, checkboxes, radio marks, chips, the off switch)', () => {
    for (const surface of SURFACES) expect(ratio(c('control-border'), c(surface)), `control-border on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  it('edges checked and selected controls at 3:1 or more, also on their own tint', () => {
    for (const surface of [...SURFACES, 'brand-soft']) {
      expect(ratio(c('brand-line'), c(surface)), `brand-line on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // The check mark and a pressed chip's label on the orange fill.
    expect(ratio(c('brand-ink'), c('brand'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the switch knob and track apart, on and off, and both tracks off the card', () => {
    expect(ratio(c('switch-knob'), c('control-border')), 'knob on the off track').toBeGreaterThanOrEqual(3);
    expect(ratio(c('switch-knob'), c('switch-on')), 'knob on the on track').toBeGreaterThanOrEqual(3);
    expect(ratio(c('switch-on'), c('surface')), 'on track on the card').toBeGreaterThanOrEqual(3);
  });

  it('keeps the old faint line for decoration only: it is under 3:1, which is why controls do not use it', () => {
    expect(ratio(c('line-strong'), c('surface'))).toBeLessThan(3);
  });

  it('shows the keyboard focus ring at 3:1 or more', () => {
    for (const surface of SURFACES) expect(ratio(c('focus'), c(surface)), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
  });

  it('meets 4.5:1 for body, secondary and muted text', () => {
    for (const text of ['ink', 'ink-2', 'muted']) {
      for (const surface of SURFACES) expect(ratio(c(text), c(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const [text, tint] of [['brand-text', 'brand-soft'], ['accent', 'accent-soft'], ['ok', 'ok-soft'], ['warn', 'warn-soft'], ['bad', 'bad-soft']]) {
      expect(ratio(c(text), c(tint)), `${text} on ${tint}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c(text), c('surface')), `${text} on surface`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(c('on-bad'), c('bad'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c('nav-ink'), c('nav-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c('nav-muted'), c('nav-bg'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('controls use the strong outline', () => {
  const rule = (selector: string) => block(`\n${selector} {`);

  it.each([
    ['.input', 'border'],
    ['.check__box,\n.option-card__box', 'border'],
    ['.radio-card__mark', 'border'],
    ['.chip', 'border'],
    ['.switch__input', 'background-color'],
  ])('%s draws its outline with --control-border', (selector, property) => {
    expect(rule(selector)).toMatch(new RegExp(`${property}:[^;]*var\\(--control-border\\)`));
  });

  it('fills a pressed toggle chip, so the List / Map toggle does not rely on a border colour', () => {
    expect(rule(".chip[aria-pressed='true']")).toMatch(/background:\s*var\(--brand\)/);
  });

  it('keeps the map pins readable: navy score on orange, white on the blue truck badge', () => {
    expect(ratio(literal('#0f1b2d'), literal('#ff6b1a'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(literal('#ffffff'), literal('#1d5fd1'))).toBeGreaterThanOrEqual(4.5);
  });
});
