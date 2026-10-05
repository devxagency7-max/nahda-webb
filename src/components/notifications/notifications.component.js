/* --------------------------------------------------------------------------
   NOTIFICATIONS BELL
   - Every `[data-notif-bell]` button (top header + dashboard hero, since the
     header is hidden on the dashboard) opens one shared dropdown panel.
   - Live updates arrive over SignalR (/hubs/notifications, event
     "ReceiveNotification" -> { title, subtitle, icon, caseId }); the list and
     the unread counter come from GET /notifications.
   - Browser (Web Push) notifications are switched on from the panel — the
     permission prompt needs a user gesture.
   -------------------------------------------------------------------------- */
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { NOTIFICATIONS_HUB_URL } from '../../config/env.js';
import { NotificationsService } from '../../services/notifications.service.js';
import { AuthService } from '../../services/auth.service.js';
import { TokenStore } from '../../services/tokens.js';
import { WebPush, isWebPushSupported } from '../../services/web-push.service.js';
import { Lifecycle } from '../../core/lifecycle.js';
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';

const PAGE_SIZE = 20;
const MAX_BADGE = 99;

let panel = null;
let activeBell = null;
let items = [];
let unreadCount = 0;
let page = 0;
let hasMore = false;
let loading = false;
let connection = null;

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function isUnread(n) {
  return n.isRead === false || (n.isRead === undefined && n.readAt == null && n.read !== true);
}

/* ------------------------------ badge / list ------------------------------ */

function renderBadge() {
  DOM.qsa('[data-notif-bell]').forEach(bell => {
    const badge = bell.querySelector('.notif-badge');
    if (!badge) return;
    badge.hidden = unreadCount <= 0;
    badge.textContent = unreadCount > MAX_BADGE ? `${MAX_BADGE}+` : String(unreadCount);
    bell.setAttribute('aria-label', unreadCount > 0 ? `الإشعارات — ${unreadCount} غير مقروء` : 'الإشعارات');
  });
}

function renderList() {
  if (!panel) return;
  const list = panel.querySelector('.notif-panel__list');
  const markAll = panel.querySelector('[data-notif-mark-all]');
  const more = panel.querySelector('[data-notif-more]');
  markAll.disabled = unreadCount <= 0;
  more.hidden = !hasMore;

  if (items.length === 0) {
    list.innerHTML = `<div class="notif-panel__empty">${loading ? 'جاري التحميل…' : 'لا توجد إشعارات'}</div>`;
    return;
  }
  list.innerHTML = items.map(n => `
    <button type="button" class="notif-item${isUnread(n) ? ' notif-item--unread' : ''}" data-notif-id="${DOM.escapeHTML(String(n.id ?? ''))}">
      <span class="notif-item__dot" aria-hidden="true"></span>
      <span class="notif-item__body">
        <span class="notif-item__title">${DOM.escapeHTML(n.title || '')}</span>
        ${n.subtitle ? `<span class="notif-item__subtitle">${DOM.escapeHTML(n.subtitle)}</span>` : ''}
        <span class="notif-item__time">${DOM.escapeHTML(formatTime(n.createdAt))}</span>
      </span>
    </button>`).join('');
}

async function loadPage(nextPage) {
  if (loading) return;
  loading = true;
  renderList();
  try {
    const data = await NotificationsService.list({ page: nextPage, limit: PAGE_SIZE });
    const fetched = (data && data.items) || [];
    items = nextPage === 1 ? fetched : [...items, ...fetched.filter(n => !items.some(i => i.id === n.id))];
    page = nextPage;
    if (typeof data?.unreadCount === 'number') unreadCount = data.unreadCount;
    const totalPages = data?.totalPages;
    hasMore = totalPages ? nextPage < totalPages : fetched.length === PAGE_SIZE;
  } catch (err) {
    console.error('[notifications] list failed:', err);
    showToast('تعذّر تحميل الإشعارات', 'error');
  } finally {
    loading = false;
    renderBadge();
    renderList();
  }
}

/* --------------------------------- actions -------------------------------- */

async function markAllRead() {
  try {
    await NotificationsService.markAllRead();
    items = items.map(n => ({ ...n, isRead: true }));
    unreadCount = 0;
    renderBadge();
    renderList();
  } catch (err) {
    console.error('[notifications] mark-all-read failed:', err);
    showToast('تعذّر تحديد الإشعارات كمقروءة', 'error');
  }
}

function openNotification(id) {
  const n = items.find(i => String(i.id) === id);
  if (!n) return;
  if (isUnread(n)) {
    // Optimistic: the counter must not lag behind the click.
    n.isRead = true;
    unreadCount = Math.max(0, unreadCount - 1);
    renderBadge();
    renderList();
    NotificationsService.markRead(n.id).catch(err => {
      console.error('[notifications] mark-read failed:', err);
      n.isRead = false;
      unreadCount += 1;
      renderBadge();
      renderList();
    });
  }
  if (n.caseId) {
    closePanel();
    if (window.openCaseDetailsPage) window.openCaseDetailsPage(n.caseId);
  }
}

/* ------------------------------ web push toggle --------------------------- */

async function refreshPushToggle() {
  if (!panel) return;
  const row = panel.querySelector('.notif-panel__push');
  const btn = panel.querySelector('[data-notif-push]');
  if (!isWebPushSupported()) {
    row.hidden = true;
    return;
  }
  if (Notification.permission === 'denied') {
    btn.disabled = true;
    btn.textContent = 'إشعارات المتصفح محظورة من إعدادات المتصفح';
    return;
  }
  const subscribed = Boolean(await WebPush.getSubscription().catch(() => null));
  btn.disabled = false;
  btn.dataset.state = subscribed ? 'on' : 'off';
  btn.textContent = subscribed ? 'إيقاف إشعارات المتصفح' : 'تفعيل إشعارات المتصفح';
}

async function togglePush() {
  const btn = panel.querySelector('[data-notif-push]');
  btn.disabled = true;
  try {
    if (btn.dataset.state === 'on') {
      await WebPush.disable();
      showToast('تم إيقاف إشعارات المتصفح', 'info');
    } else if ((await WebPush.enable()) === 'enabled') {
      showToast('تم تفعيل إشعارات المتصفح');
    } else {
      showToast('لم يتم السماح بالإشعارات من المتصفح', 'warning');
    }
  } catch (err) {
    console.error('[notifications] web push toggle failed:', err);
    showToast('تعذّر تغيير إعداد إشعارات المتصفح', 'error');
  }
  await refreshPushToggle();
}

/* ---------------------------------- panel --------------------------------- */

function buildPanel() {
  panel = DOM.createElement('div', { className: 'notif-panel', role: 'dialog', 'aria-label': 'الإشعارات' });
  panel.hidden = true;
  panel.innerHTML = `
    <div class="notif-panel__head">
      <strong>الإشعارات</strong>
      <button type="button" class="notif-panel__link" data-notif-mark-all>قراءة الكل</button>
    </div>
    <div class="notif-panel__list"></div>
    <button type="button" class="notif-panel__more" data-notif-more hidden>عرض المزيد</button>
    <div class="notif-panel__push">
      <button type="button" class="notif-panel__link" data-notif-push></button>
    </div>`;
  document.body.appendChild(panel);

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('[data-notif-id]');
    if (item) return openNotification(item.dataset.notifId);
    if (e.target.closest('[data-notif-mark-all]')) return markAllRead();
    if (e.target.closest('[data-notif-more]')) return loadPage(page + 1);
    if (e.target.closest('[data-notif-push]')) return togglePush();
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('[data-notif-bell]')) closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      const bell = activeBell;
      closePanel();
      bell?.focus();
    }
  });
}

function positionPanel(bell) {
  const rect = bell.getBoundingClientRect();
  panel.style.top = `${Math.round(rect.bottom + 8)}px`;
  // Align the panel's left edge with the bell's, clamped inside the viewport.
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - panel.offsetWidth - 8);
  panel.style.left = `${Math.round(left)}px`;
}

function openPanel(bell) {
  activeBell = bell;
  panel.hidden = false;
  bell.setAttribute('aria-expanded', 'true');
  positionPanel(bell);
  refreshPushToggle();
  loadPage(1);
}

function closePanel() {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  activeBell?.setAttribute('aria-expanded', 'false');
  activeBell = null;
}

/* --------------------------------- realtime ------------------------------- */

async function getAccessToken() {
  // Reconnects can happen long after the 15-min access token expired; any
  // authenticated call goes through http.js's 401 -> refresh -> retry.
  if (TokenStore.isAccessTokenExpiring()) await AuthService.me().catch(() => {});
  return TokenStore.getAccessToken() || '';
}

function onNotification(notification) {
  if (!notification) return;
  unreadCount += 1;
  renderBadge();
  // Re-fetch rather than guess the server-side id/createdAt of the new row.
  if (panel && !panel.hidden) loadPage(1);
  showToast(notification.title || 'إشعار جديد', 'info', undefined, notification.caseId ? {
    action: { label: 'عرض', onClick: () => window.openCaseDetailsPage?.(notification.caseId) }
  } : {});
}

async function refreshUnreadCount() {
  try {
    const data = await NotificationsService.list({ page: 1, limit: 1 });
    if (typeof data?.unreadCount === 'number') {
      unreadCount = data.unreadCount;
      renderBadge();
    }
  } catch (err) {
    console.warn('[notifications] unread count refresh failed:', err);
  }
}

async function startRealtime() {
  connection = new HubConnectionBuilder()
    .withUrl(NOTIFICATIONS_HUB_URL, { accessTokenFactory: getAccessToken })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build();

  connection.on('ReceiveNotification', onNotification);
  // Anything pushed while disconnected is only visible through the REST list.
  connection.onreconnected(() => refreshUnreadCount());

  try {
    await connection.start();
  } catch (err) {
    // Non-fatal: the bell still works through REST.
    console.warn('[notifications] realtime connection failed:', err);
  }
}

/* ----------------------------------- init --------------------------------- */

export function initNotifications() {
  const bells = DOM.qsa('[data-notif-bell]');
  if (bells.length === 0) return;

  buildPanel();
  bells.forEach(bell => {
    bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false');
    bell.addEventListener('click', () => {
      if (!panel.hidden && activeBell === bell) closePanel();
      else openPanel(bell);
    });
  });
  window.addEventListener('resize', () => { if (activeBell && !panel.hidden) positionPanel(activeBell); });

  refreshUnreadCount();
  startRealtime();
  Lifecycle.addCleanup(() => {
    if (connection && connection.state !== HubConnectionState.Disconnected) connection.stop().catch(() => {});
  });
  WebPush.syncExisting().catch(err => console.warn('[notifications] web push sync failed:', err));

  // Click on a system notification while the app is open (see public/sw.js).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'notification-click' && e.data.caseId) window.openCaseDetailsPage?.(e.data.caseId);
    });
  }
  // Click on a system notification that had to open a fresh tab: /?case=<id>.
  const caseParam = new URLSearchParams(window.location.search).get('case');
  if (caseParam) {
    history.replaceState(null, '', window.location.pathname);
    // case-details registers openCaseDetailsPage during the same boot.
    setTimeout(() => window.openCaseDetailsPage?.(caseParam), 0);
  }
}
