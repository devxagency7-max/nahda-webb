/* --------------------------------------------------------------------------
   PAGE VIEW ROUTER ENGINE
   Manages page view switching, breadcrumb updates, active sidebar states,
   and page scroll position.
   -------------------------------------------------------------------------- */
import { store } from '../state/store.js';
import { showToast } from '../utils/toast.js';
import { DOM } from '../utils/dom.js';
import { canAccessView, ROLE_LABELS } from './permissions.js';
import { AuthService } from '../services/auth.service.js';
import { ProfileService } from '../services/profile.service.js';
import { TokenStore } from '../services/tokens.js';
import { EventBus, EVENTS } from './event-bus.js';
import { StorageService, STORAGE_KEYS } from '../services/storage.js';

export function switchView(viewName, saveToStorage = true) {
  // بوابة الصلاحيات: أي محاولة لفتح شاشة خارج صلاحيات الدور الحالي — سواء من
  // رابط، أو من عرض محفوظ في localStorage لمستخدم سابق — بترجع للوحة التحكم.
  if (viewName !== 'login' && !canAccessView(viewName)) {
    showToast('ليس من صلاحياتك الوصول لهذه الصفحة ⛔');
    viewName = 'dashboard';
  }

  const navBgLink = DOM.qs('#nav-bg-card-link');
  const viewLogin = DOM.qs('#view-login');
  const viewDashboard = DOM.qs('#view-dashboard');
  const viewPersonalData = DOM.qs('#view-personal-data');
  const viewBgStudio = DOM.qs('#view-bg-studio');
  const viewStateMgmt = DOM.qs('#view-state-mgmt');
  const viewCharities = DOM.qs('#view-charities');
  const viewProfile = DOM.qs('#view-profile');
  const viewAllCases = DOM.qs('#view-all-cases');
  const viewCaseDetails = DOM.qs('#view-case-details');
  const viewEmployees = DOM.qs('#view-employees');
  const viewReports = DOM.qs('#view-reports');
  const viewCaseSupportFilter = DOM.qs('#view-case-support-filter');
  const breadcrumb = DOM.qs('.breadcrumb');

  if (saveToStorage) {
    store.setCurrentView(viewName, true);
  } else {
    store.setCurrentView(viewName, false);
  }

  // آخر id لصفحة تفاصيل حالة اتفتحت — مفيد بس طول ما المستخدم لسه واقف على
  // case-details (عشان استعادتها بعد refresh)؛ أي انتقال لصفحة تانية يبطّله.
  if (viewName !== 'case-details') {
    StorageService.remove(STORAGE_KEYS.LAST_VIEWED_CASE_ID);
  }

  // Hide all view panels
  if (viewLogin) viewLogin.classList.add('page-view--hidden');
  if (viewDashboard) viewDashboard.classList.add('page-view--hidden');
  if (viewPersonalData) viewPersonalData.classList.add('page-view--hidden');
  if (viewBgStudio) viewBgStudio.classList.add('page-view--hidden');
  if (viewStateMgmt) viewStateMgmt.classList.add('page-view--hidden');
  if (viewCharities) viewCharities.classList.add('page-view--hidden');
  if (viewProfile) viewProfile.classList.add('page-view--hidden');
  if (viewAllCases) viewAllCases.classList.add('page-view--hidden');
  if (viewCaseDetails) viewCaseDetails.classList.add('page-view--hidden');
  if (viewEmployees) viewEmployees.classList.add('page-view--hidden');
  if (viewReports) viewReports.classList.add('page-view--hidden');
  if (viewCaseSupportFilter) viewCaseSupportFilter.classList.add('page-view--hidden');

  // Toggle login screen body mode
  document.body.classList.toggle('is-login-view', viewName === 'login');

  // Remove active styles from sidebar links
  DOM.qsa('.sidebar-sublink').forEach(link => link.classList.remove('sidebar-sublink--active'));
  DOM.qsa('.accordion-header').forEach(hdr => hdr.classList.remove('accordion-header--active'));

  document.body.classList.toggle('is-dashboard-view', viewName !== 'personal-data' && viewName !== 'bg-studio' && viewName !== 'state-mgmt' && viewName !== 'charities' && viewName !== 'profile' && viewName !== 'all-cases' && viewName !== 'case-details' && viewName !== 'employees' && viewName !== 'reports' && viewName !== 'case-support-filter' && viewName !== 'login');

  if (viewName === 'login') {
    if (viewLogin) viewLogin.classList.remove('page-view--hidden');
  } else if (viewName === 'case-details') {
    if (viewCaseDetails) viewCaseDetails.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>سجل الحالات</span>
        <span>/</span>
        <span class="breadcrumb__item--active">تفاصيل وفحص الحالة الشامل وقرار المراجع</span>
      `;
    }
  } else if (viewName === 'employees') {
    if (viewEmployees) viewEmployees.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة النظام</span>
        <span>/</span>
        <span class="breadcrumb__item--active">إدارة الموظفين وفرق العمل</span>
      `;
    }
    const navEmployeesLink = DOM.qs('#nav-employees-link');
    if (navEmployeesLink) navEmployeesLink.classList.add('accordion-header--active');

    // Close other open accordion bodies for a clean sidebar state
    DOM.qsa('.accordion-group--open').forEach(group => {
      group.classList.remove('accordion-group--open');
      const body = group.querySelector('.accordion-body');
      if (body) body.style.maxHeight = null;
    });
  } else if (viewName === 'reports') {
    if (viewReports) viewReports.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة النظام</span>
        <span>/</span>
        <span class="breadcrumb__item--active">التقارير والإحصائيات</span>
      `;
    }
    const navReportsLink = DOM.qs('#nav-reports-link');
    if (navReportsLink) navReportsLink.classList.add('accordion-header--active');

    // Close other open accordion bodies for a clean sidebar state
    DOM.qsa('.accordion-group--open').forEach(group => {
      group.classList.remove('accordion-group--open');
      const body = group.querySelector('.accordion-body');
      if (body) body.style.maxHeight = null;
    });

    EventBus.emit('reports:opened');
  } else if (viewName === 'case-support-filter') {
    if (viewCaseSupportFilter) viewCaseSupportFilter.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة النظام</span>
        <span>/</span>
        <span class="breadcrumb__item--active">فلترة الحالات حسب الجمعية والدعم</span>
      `;
    }
    const navCaseSupportFilterLink = DOM.qs('#nav-case-support-filter-link');
    if (navCaseSupportFilterLink) navCaseSupportFilterLink.classList.add('accordion-header--active');

    // Close other open accordion bodies for a clean sidebar state
    DOM.qsa('.accordion-group--open').forEach(group => {
      group.classList.remove('accordion-group--open');
      const body = group.querySelector('.accordion-body');
      if (body) body.style.maxHeight = null;
    });
  } else if (viewName === 'all-cases') {
    if (viewAllCases) viewAllCases.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة البيانات</span>
        <span>/</span>
        <span class="breadcrumb__item--active">سجل الحالات والملفات</span>
      `;
    }
  } else if (viewName === 'profile') {
    if (viewProfile) viewProfile.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إعدادات الحساب</span>
        <span>/</span>
        <span class="breadcrumb__item--active">تعديل الملف الشخصي</span>
      `;
    }
  } else if (viewName === 'bg-studio') {
    if (viewBgStudio) viewBgStudio.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إعدادات النظام</span>
        <span>/</span>
        <span class="breadcrumb__item--active">استوديو التحكم بالخلفية</span>
      `;
    }
    if (navBgLink) navBgLink.classList.add('sidebar-sublink--active');

    // Auto open system settings accordion group
    const bgGroup = navBgLink ? navBgLink.closest('.accordion-group') : null;
    if (bgGroup) {
      bgGroup.classList.add('accordion-group--open');
      const body = bgGroup.querySelector('.accordion-body');
      if (body) body.style.maxHeight = (body.scrollHeight + 40) + 'px';
    }
  } else if (viewName === 'charities') {
    if (viewCharities) viewCharities.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة البيانات</span>
        <span>/</span>
        <span class="breadcrumb__item--active">إدارة الجمعيات</span>
      `;
    }
    const activeSublink = DOM.qs('.sidebar-sublink[data-view-target="charities"]');
    if (activeSublink) activeSublink.classList.add('sidebar-sublink--active');

    const dataGroup = activeSublink ? activeSublink.closest('.accordion-group') : null;
    if (dataGroup) {
      dataGroup.classList.add('accordion-group--open');
      const body = dataGroup.querySelector('.accordion-body');
      if (body) body.style.maxHeight = (body.scrollHeight + 40) + 'px';
    }
  } else if (viewName === 'state-mgmt') {
    if (viewStateMgmt) viewStateMgmt.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة البيانات</span>
        <span>/</span>
        <span class="breadcrumb__item--active">إدارة بيانات الحالة</span>
      `;
    }
    const activeSublink = DOM.qs('.sidebar-sublink[data-view-target="state-mgmt"]');
    if (activeSublink) activeSublink.classList.add('sidebar-sublink--active');

    const dataGroup = activeSublink ? activeSublink.closest('.accordion-group') : null;
    if (dataGroup) {
      dataGroup.classList.add('accordion-group--open');
      const body = dataGroup.querySelector('.accordion-body');
      if (body) body.style.maxHeight = (body.scrollHeight + 40) + 'px';
    }
  } else if (viewName === 'personal-data') {
    if (viewPersonalData) viewPersonalData.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span>الرئيسية</span>
        <span>/</span>
        <span>إدارة البيانات</span>
        <span>/</span>
        <span class="breadcrumb__item--active">البيانات الأساسية</span>
      `;
    }
    const activeSublink = DOM.qs('.sidebar-sublink[data-view-target="personal-data"]');
    if (activeSublink) activeSublink.classList.add('sidebar-sublink--active');

    const dataGroup = activeSublink ? activeSublink.closest('.accordion-group') : null;
    if (dataGroup) {
      dataGroup.classList.add('accordion-group--open');
      const body = dataGroup.querySelector('.accordion-body');
      if (body) body.style.maxHeight = (body.scrollHeight + 40) + 'px';
    }
  } else {
    // Default: Dashboard / الرئيسية
    if (viewDashboard) viewDashboard.classList.remove('page-view--hidden');
    if (breadcrumb) {
      breadcrumb.innerHTML = `
        <span class="breadcrumb__item--active">الرئيسية / لوحة التحكم</span>
      `;
    }
    const navDashLink = DOM.qs('#nav-dashboard-link');
    if (navDashLink) navDashLink.classList.add('accordion-header--active');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Clears the session (local + best-effort server-side revoke) and returns to
 * the login screen. Shared by the manual "تسجيل الخروج" click and by an
 * involuntary session expiry (http.js's refresh-failed path).
 */
async function performLogout() {
  store.clearCurrentUser();
  switchView('login');
  try {
    await AuthService.logout();
  } catch {
    // Best-effort — tokens are already cleared client-side either way, and
    // the backend's logout is idempotent/never reveals failures (§2.3).
  }
}

export function initPageViewNavigation() {
  const btnBack = DOM.qs('#btn-back-to-personal-data');

  // Involuntary logout: fired by http.js when a 401 survives one refresh
  // attempt. Tokens are already cleared there — just reset UI state and go
  // back to the login screen with an explanation.
  EventBus.on(EVENTS.SESSION_EXPIRED, () => {
    if (store.currentView === 'login') return;
    store.clearCurrentUser();
    switchView('login');
    showToast('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى');
  });

  // Make switchView globally accessible for backward compatibility
  window.switchView = switchView;

  // Bind click handlers for elements with data-view-target via event delegation
  document.addEventListener('click', (e) => {
    const targetEl = e.target.closest('[data-view-target]');
    if (targetEl) {
      e.preventDefault();

      // تسجيل الخروج: يبطّل جلسة هذا الجهاز على السيرفر (§2.3 logout) قبل
      // التحويل لشاشة الدخول — وليس مجرد تبديل شاشة كباقي الروابط.
      if (targetEl.id === 'nav-logout-link') {
        performLogout();
        return;
      }

      const target = targetEl.getAttribute('data-view-target');
      switchView(target);
    }
  });

  if (btnBack) {
    btnBack.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('personal-data');
    });
  }

  // Boot guard: a saved view/user in localStorage is only trustworthy if a
  // refresh token still backs it. No token -> straight to login, regardless
  // of what was last open. A token that exists gets verified against
  // /auth/me in the background (catches a since-deactivated account) —
  // the saved view opens immediately so the app doesn't stall on that call.
  if (!TokenStore.hasSession()) {
    store.clearCurrentUser();
    switchView('login', false);
  } else {
    const savedView = store.currentView || 'dashboard';
    switchView(savedView, false);
    AuthService.me()
      .then(async (user) => {
        store.replaceCurrentUser({
          name: user.fullName,
          roleLabel: ROLE_LABELS[user.role] || 'موظف',
          roleCode: user.role,
          email: user.email,
          id: user.id,
          permissions: user.permissions || [],
          avatar: store.currentUser?.avatar || null
        });

        // Enrich with fresh presigned avatarUrl and profile fields
        try {
          const profile = await ProfileService.getProfile();
          if (profile) {
            store.setCurrentUser({
              phone: profile.phone || '',
              gender: profile.gender || 'male',
              avatar: profile.avatarUrl || null
            });
          }
        } catch {
          // Non-critical background refresh failure
        }
      })
      .catch(() => {
        // Invalid/expired/account gone — http.js already tried a refresh
        // and, on failure, already emitted SESSION_EXPIRED (handled above).
      });
  }

  return switchView;
}
