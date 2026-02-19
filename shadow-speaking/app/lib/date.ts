/**
 * Get current date string in Beijing time (UTC+8).
 * Used throughout the app for consistent date handling.
 */
export function getChinaDateString(): string {
  const now = new Date();
  const chinaOffset = 8 * 60 * 60 * 1000;
  return new Date(now.getTime() + chinaOffset).toISOString().slice(0, 10);
}
