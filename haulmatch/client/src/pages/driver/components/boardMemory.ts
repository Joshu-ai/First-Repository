import { paths } from '../../../lib/routes';

// The load board keeps its filters in the URL; remembering the last one lets "Back to loads"
// on a load detail page return to the same search. Storage can be unavailable (private mode),
// so every access is guarded and falls back to the plain board.
const KEY = 'hm.driver.boardSearch';

export function rememberBoardSearch(search: string): void {
  try {
    sessionStorage.setItem(KEY, search);
  } catch {
    // Not critical: the back link just opens the unfiltered board.
  }
}

/** "/driver/loads?equipment=..." for the last board search in this tab. */
export function lastBoardPath(): string {
  try {
    const search = sessionStorage.getItem(KEY);
    return search ? `${paths.driverLoads}?${search}` : paths.driverLoads;
  } catch {
    return paths.driverLoads;
  }
}
