/** Join class names, skipping falsy values: cx('btn', primary && 'btn--primary'). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
