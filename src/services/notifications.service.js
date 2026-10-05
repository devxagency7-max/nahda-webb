/* --------------------------------------------------------------------------
   NOTIFICATIONS SERVICE
   Wraps /api/v1/notifications/* (list, read, Web Push subscription).
   Every endpoint only needs the JWT — no special permission.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';

export const NotificationsService = {
  /**
   * @param {{page?: number, limit?: number}} [query]
   * @returns {Promise<{items: Array, unreadCount?: number, total?: number, totalPages?: number}>}
   */
  list({ page = 1, limit = 20 } = {}) {
    return HttpClient.get('/notifications', { query: { page, limit } });
  },

  markAllRead() {
    return HttpClient.put('/notifications/mark-all-read');
  },

  markRead(id) {
    return HttpClient.put(`/notifications/${encodeURIComponent(id)}/read`);
  },

  /** @returns {Promise<{publicKey: string}>} VAPID public key for PushManager.subscribe(). */
  getVapidPublicKey() {
    return HttpClient.get('/notifications/vapid-public-key');
  },

  /** @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription */
  subscribeWebPush(subscription) {
    return HttpClient.post('/notifications/web-push', { body: subscription });
  },

  /** @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription */
  unsubscribeWebPush(subscription) {
    return HttpClient.delete('/notifications/web-push', { body: subscription });
  }
};
