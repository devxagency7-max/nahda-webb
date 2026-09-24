/* --------------------------------------------------------------------------
   AUTH SERVICE
   Thin wrapper around the /auth/* endpoints (WEB_API_DOCUMENTATION.md §2).
   Owns nothing about UI/state — login.component.js and app.js decide what to
   do with the results. http.js already attaches X-Client-Type: web for these
   three routes and never runs the 401-retry machinery on them.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { TokenStore } from './tokens.js';

export const AuthService = {
  /**
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{accessToken,refreshToken,expiresIn,user}>}
   * @throws {ApiError} INVALID_CREDENTIALS | ACCOUNT_LOCKED | PLATFORM_NOT_ALLOWED
   *   | SOCIAL_WORKER_WEB_BLOCKED | RATE_LIMITED | VALIDATION_ERROR
   */
  async login(email, password) {
    const data = await HttpClient.post('/auth/login', { body: { email, password } });
    TokenStore.setSession(data);
    return data;
  },

  /**
   * Re-reads the user from the DB (catches a deactivated account mid-session).
   * @returns {Promise<Object>} AuthenticatedUserDto
   * @throws {ApiError} NOT_FOUND if the account no longer exists
   */
  async me() {
    return HttpClient.get('/auth/me');
  },

  /**
   * Revokes only this device's session. Always resolves (backend is
   * idempotent — an already-revoked/unknown token still returns 200) but we
   * still clear local tokens unconditionally regardless of the outcome.
   */
  async logout() {
    const refreshToken = TokenStore.getRefreshToken();
    try {
      if (refreshToken) {
        await HttpClient.post('/auth/logout', { body: { refreshToken } });
      }
    } finally {
      TokenStore.clearSession();
    }
  }
};
