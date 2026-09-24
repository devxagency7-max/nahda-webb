/* --------------------------------------------------------------------------
   TOKEN SESSION STORE
   Holds the access/refresh token pair. Kept separate from state/store.js
   because it is read synchronously by http.js on every request, before the
   reactive store (or any component) needs to know about it.
   -------------------------------------------------------------------------- */
import { StorageService, STORAGE_KEYS } from './storage.js';

// Refresh a little before actual expiry (server: 15 min access tokens) so a
// request never races the exact expiry instant.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

export const TokenStore = {
  getAccessToken() {
    return StorageService.get(STORAGE_KEYS.ACCESS_TOKEN, null);
  },

  getRefreshToken() {
    return StorageService.get(STORAGE_KEYS.REFRESH_TOKEN, null);
  },

  /** True once the access token is expired or within the safety margin. */
  isAccessTokenExpiring() {
    const expiresAt = StorageService.get(STORAGE_KEYS.TOKEN_EXPIRES_AT, null);
    if (!expiresAt) return true;
    return Date.now() >= (Number(expiresAt) - EXPIRY_SAFETY_MARGIN_MS);
  },

  hasSession() {
    return Boolean(this.getRefreshToken());
  },

  /**
   * @param {{accessToken:string, refreshToken:string, expiresIn:number}} session
   *   expiresIn is in seconds (server default: 900 = 15 min).
   */
  setSession({ accessToken, refreshToken, expiresIn }) {
    StorageService.set(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    StorageService.set(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
    StorageService.set(STORAGE_KEYS.TOKEN_EXPIRES_AT, Date.now() + (expiresIn * 1000));
  },

  clearSession() {
    StorageService.remove(STORAGE_KEYS.ACCESS_TOKEN);
    StorageService.remove(STORAGE_KEYS.REFRESH_TOKEN);
    StorageService.remove(STORAGE_KEYS.TOKEN_EXPIRES_AT);
  }
};
