/* --------------------------------------------------------------------------
   RUNTIME ENVIRONMENT CONFIG
   Single place that reads Vite env vars, with a safe fallback so the app
   still boots (pointed straight at the backend) if .env is missing.
   -------------------------------------------------------------------------- */

// Falls back to the dev-proxy path; vite.config.js proxies /api -> the real
// backend so the browser never has to deal with the backend's CORS-less setup.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
