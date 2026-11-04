import { recheckPending } from "./lib/domains";

// Rechecks custom domains that are still waiting for DNS every 5 minutes, so they go live on their own once the
// customer's records show up.
const g = globalThis as unknown as { __domainTimer?: NodeJS.Timeout };
if (!g.__domainTimer) {
  g.__domainTimer = setInterval(() => { recheckPending().catch(() => {}); }, 5 * 60_000);
  g.__domainTimer.unref?.();
}
