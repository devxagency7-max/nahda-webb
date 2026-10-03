/* --------------------------------------------------------------------------
   SESSION TEARDOWN
   One place that knows everything tied to the signed-in account, so a logout
   (manual, expired session, or rejected role) can't leave the previous user's
   data behind for the next login.

   Two layers:
   1. clearSessionData() — wipes tokens, persisted state, the store and every
      account-scoped cache (incl. the sessionStorage-backed admin dropdown
      cache, which would otherwise survive a reload and leak the admin option
      lists to the next account in the same tab).
      Deliberately kept: the localStorage reference cache (services/
      reference-data.js — dropdown options, centers/villages, charities). It
      is identical for every signed-in user (backend-confirmed), so it is not
      account data, and keeping it is what lets the next login skip ~19 requests.
   2. endSession() — clearSessionData() + a full page reload. The views are
      pre-rendered and each component keeps its own closure/module state
      (case lists, form inputs, timeline cache...) with no teardown contract,
      so a reload is the only way to guarantee none of it carries over.
   -------------------------------------------------------------------------- */
import { store } from '../state/store.js';
import { TokenStore } from '../services/tokens.js';
import { DropdownsService } from '../services/dropdowns.service.js';
import { clearReportsCache } from '../services/reports.service.js';

// Survives the reload (sessionStorage) so the user still sees why they were
// signed out, e.g. "انتهت صلاحية الجلسة".
const POST_RELOAD_TOAST_KEY = 'nahda_post_reload_toast';

export function clearSessionData() {
  TokenStore.clearSession();
  store.resetSessionState();
  DropdownsService.clearAdminCache();
  clearReportsCache();
}

/**
 * Clears the session and reloads into a pristine login screen.
 * @param {{message?: string}} [opts] - toast to show once the page is back up
 */
export function endSession({ message } = {}) {
  clearSessionData();
  try {
    if (message) sessionStorage.setItem(POST_RELOAD_TOAST_KEY, message);
  } catch {
    // Best-effort — the reload matters more than the explanation.
  }
  // resetSessionState() leaves the persisted view alone (it's shared with the
  // boot path) — reset it so the reload can't reopen a protected view.
  store.setCurrentView('login');
  window.location.reload();
}

/**
 * Called right after a successful login. Data-loading components are not
 * initialised while signed out (see app.js), so reload into the app: the boot
 * then has a session and initialises everything, exactly like a signed-in refresh.
 * @param {{message?: string}} [opts] - toast to show once the page is back up
 */
export function startSignedInSession({ message } = {}) {
  try {
    if (message) sessionStorage.setItem(POST_RELOAD_TOAST_KEY, message);
  } catch {
    // Best-effort — the reload matters more than the greeting.
  }
  store.setCurrentView('dashboard');
  window.location.reload();
}

/** Returns (and forgets) the message left by endSession(), if any. */
export function takePostReloadToast() {
  try {
    const message = sessionStorage.getItem(POST_RELOAD_TOAST_KEY);
    if (message) sessionStorage.removeItem(POST_RELOAD_TOAST_KEY);
    return message;
  } catch {
    return null;
  }
}
