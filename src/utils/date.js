/* --------------------------------------------------------------------------
   DATE & TIME UTILITIES
   Provides live Arabic date formatting and time-aware Arabic greetings
   (صباح الخير / مساء الخير).
   -------------------------------------------------------------------------- */

/**
 * Returns a time-based Arabic greeting based on the current hour:
 * - 05:00 to 11:59: "صباح الخير" (Good Morning)
 * - 12:00 to 04:59: "مساء الخير" (Good Evening)
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getTimeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) {
    return 'صباح الخير';
  }
  return 'مساء الخير';
}

/**
 * Formats a given Date into a standard Arabic localized date string
 * e.g. "السبت، 22 أغسطس 2026"
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getFormattedArabicDate(date = new Date()) {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('ar-EG', options);
}

/**
 * Formats a Date as YYYY-MM-DD using its LOCAL calendar day.
 *
 * Never use `Date.prototype.toISOString()` for a date-only value — it
 * silently converts to UTC first. Confirmed real bug: Egypt is UTC+2, so
 * for any local time between 00:00 and 02:00, `toISOString()` still
 * reports the *previous* day. That mismatch is exactly what made
 * newly-registered cases invisible under the "اليوم" (today) date-range
 * filter on the all-cases/dashboard search — the case's registrationDate
 * (server, local Egypt day) and the filter's dateFrom/dateTo (frontend,
 * previously UTC-shifted via toISOString()) disagreed near local midnight.
 * @param {Date} [date=new Date()]
 * @returns {string} e.g. "2026-09-22"
 */
export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a UTC timestamp from the API as an Arabic date + time in Egypt's
 * timezone, e.g. "السبت، 26 سبتمبر 2026 — 10:10 ص". The timezone is pinned
 * to Africa/Cairo (not the viewer's machine) so every user sees the same
 * office time for a workflow event.
 * @param {string} utcString - ISO timestamp, e.g. "2026-09-26T08:10:05.12+00:00"
 * @returns {string} '' for a missing/invalid value
 */
export function formatCairoDateTime(utcString) {
  if (!utcString) return '';
  const date = new Date(utcString);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('ar-EG', {
    timeZone: 'Africa/Cairo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const time = date.toLocaleTimeString('ar-EG', {
    timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit'
  });
  return `${day} — ${time}`;
}
