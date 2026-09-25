/**
 * Which screenshot-related alerts a batch of events should raise.
 *
 * Both alerts are about screenshots the organization is supposed to be getting.
 * When the screenshots capability is off there are none, on purpose, so:
 *  - "no recent capture" would fire on every app-only batch about a setting that
 *    was chosen, and
 *  - "low activity" would fire on the activity level of screenshots that were
 *    just discarded, then link to screenshots that do not exist.
 * Neither is a problem to report, so neither is raised.
 *
 * Kept free of imports so it can be tested without a database.
 */
export function planScreenshotAlerts(events, screenshotsAllowed) {
  const none = { lowActivityLevels: [], missingScreenshot: false };
  if (!screenshotsAllowed) return none;

  const list = Array.isArray(events) ? events.filter((ev) => ev && typeof ev === "object") : [];
  const screenshots = list.filter((ev) => ev.type === "screenshot");

  if (screenshots.length) {
    return {
      lowActivityLevels: screenshots.map((ev) => ev.activityLevel).filter((level) => typeof level === "number"),
      missingScreenshot: false,
    };
  }
  return { ...none, missingScreenshot: list.some((ev) => ev.type === "app") };
}
