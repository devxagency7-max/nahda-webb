/* --------------------------------------------------------------------------
   WEB PUSH (browser notifications)
   Service worker (public/sw.js) + PushManager subscription, registered with
   the backend through NotificationsService. Subscribing needs a user gesture
   for the permission prompt, so enable() is only called from the bell panel's
   toggle; syncExisting() silently re-registers an already-granted
   subscription on boot (the backend call is idempotent).
   -------------------------------------------------------------------------- */
import { NotificationsService } from './notifications.service.js';

const SW_URL = '/sw.js';

export function isWebPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

/** PushSubscription -> the body the backend expects: { endpoint, keys: { p256dh, auth } }. */
function toPayload(subscription) {
  const { endpoint, keys } = subscription.toJSON();
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

async function getRegistration() {
  await navigator.serviceWorker.register(SW_URL);
  return navigator.serviceWorker.ready;
}

export const WebPush = {
  /** @returns {Promise<PushSubscription|null>} */
  async getSubscription() {
    if (!isWebPushSupported()) return null;
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    return registration ? registration.pushManager.getSubscription() : null;
  },

  /**
   * Asks for permission, subscribes and registers with the backend.
   * @returns {Promise<'enabled'|'denied'>}
   */
  async enable() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const registration = await getRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { publicKey } = await NotificationsService.getVapidPublicKey();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    await NotificationsService.subscribeWebPush(toPayload(subscription));
    return 'enabled';
  },

  /** Removes the subscription from the backend and the browser. */
  async disable() {
    const subscription = await this.getSubscription();
    if (!subscription) return;
    const payload = toPayload(subscription);
    await subscription.unsubscribe();
    await NotificationsService.unsubscribeWebPush(payload);
  },

  /** Boot-time re-registration for a browser that already granted permission. */
  async syncExisting() {
    if (!isWebPushSupported() || Notification.permission !== 'granted') return;
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await NotificationsService.subscribeWebPush(toPayload(subscription));
  },

  /**
   * Logout: drop only the backend's link between this browser and the account
   * (needs the still-valid token), so a different user signing in here doesn't
   * receive the previous user's pushes. The browser subscription is kept;
   * syncExisting() re-links it at the next sign-in.
   */
  async detachFromAccount() {
    const subscription = await this.getSubscription();
    if (subscription) await NotificationsService.unsubscribeWebPush(toPayload(subscription));
  }
};
