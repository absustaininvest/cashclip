import { getSetting, setSetting } from "./runtimeSettings";

/**
 * Settings key used to store the sponsored-visit alert debounce timestamp.
 * Value is an ISO-8601 string of the time the alert was last sent (or a
 * future time when a snooze is active). The monitor should not re-fire before
 * this timestamp has elapsed.
 */
export const SPONSORED_VISIT_ALERT_DEBOUNCE_KEY = "sponsored_visit_alert_last_sent";

/**
 * Read the current debounce timestamp from the settings cache.
 * Returns null when no debounce is set (monitor is free to fire).
 */
export function getSponsoredVisitAlertDebounce(): Date | null {
  const raw = getSetting(SPONSORED_VISIT_ALERT_DEBOUNCE_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Write the debounce timestamp.
 *
 * @param hoursFromNow  When > 0, the debounce is set to `now + hoursFromNow`
 *                      hours (snooze mode). When 0 / undefined, it is set to
 *                      the current time (standard "mark as sent" behaviour —
 *                      the normal monitor debounce window then applies).
 */
export async function writeLastAlerted(hoursFromNow = 0): Promise<void> {
  const ts = hoursFromNow > 0
    ? new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
    : new Date();
  await setSetting(SPONSORED_VISIT_ALERT_DEBOUNCE_KEY, ts.toISOString());
}

/**
 * Clear the debounce entirely so the monitor can fire on the very next tick.
 */
export async function clearSponsoredVisitAlertDebounce(): Promise<void> {
  await setSetting(SPONSORED_VISIT_ALERT_DEBOUNCE_KEY, "");
}

/**
 * Returns true when a snooze is currently active (the stored timestamp is in
 * the future), false otherwise.
 */
export function isSnoozed(): boolean {
  const d = getSponsoredVisitAlertDebounce();
  return d != null && d.getTime() > Date.now();
}
