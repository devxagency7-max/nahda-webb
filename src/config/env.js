/* --------------------------------------------------------------------------
   RUNTIME ENVIRONMENT CONFIG
   Single place that reads Vite env vars, with a safe fallback so the app
   still boots (pointed straight at the backend) if .env is missing.
   -------------------------------------------------------------------------- */

// Falls back to the dev-proxy path; vite.config.js proxies /api -> the real
// backend so the browser never has to deal with the backend's CORS-less setup.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

// Max time (ms) a single API request may take — connect + response + body —
// before it is aborted and surfaced as a RequestTimeoutError. Without it a
// hung server leaves the UI on "loading" forever.
function readTimeout(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
export const API_TIMEOUT_MS = readTimeout(import.meta.env.VITE_API_TIMEOUT_MS, 30000);
// Longer budget for streaming downloads such as the CSV report export.
export const API_EXPORT_TIMEOUT_MS = readTimeout(import.meta.env.VITE_API_EXPORT_TIMEOUT_MS, 120000);

// SignalR hub for live notifications. Same-origin by default (proxied by Vite
// in dev and by nginx in production — see vite.config.js / nginx.conf), for the
// same reason as the API: the backend sends no CORS headers.
export const NOTIFICATIONS_HUB_URL = import.meta.env.VITE_NOTIFICATIONS_HUB_URL || '/hubs/notifications';
