/* --------------------------------------------------------------------------
   LOGIN SCREEN COMPONENT CONTROLLER
   Manages login form submission, password toggling, and transition to the
   main dashboard. Talks to the real backend via AuthService — see
   WEB_API_DOCUMENTATION.md §2 for the exact contract.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { startSignedInSession } from '../../core/session.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { getTimeGreeting } from '../../utils/date.js';
import { ROLE_LABELS } from '../../core/permissions.js';
import { AuthService } from '../../services/auth.service.js';
import { ProfileService } from '../../services/profile.service.js';
import { ApiError } from '../../services/errors.js';

// Messages for the login-specific error codes (§2.3). Anything else falls
// back to messageFromError()'s generic catalogue.
const LOGIN_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  ACCOUNT_LOCKED: 'تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة متكررة — حاول بعد 15 دقيقة 🔒',
  PLATFORM_NOT_ALLOWED: 'هذا الحساب غير مسموح له بالدخول من الويب',
  SOCIAL_WORKER_WEB_BLOCKED: 'الأخصائي الميداني يسجّل الدخول من تطبيق الموبايل وليس من الويب 📱',
  RATE_LIMITED: 'عدد كبير من محاولات الدخول، حاول بعد قليل',
  VALIDATION_ERROR: 'من فضلك أدخل بريدًا إلكترونيًا وكلمة مرور صحيحين'
};

export function initLoginScreen() {
  const loginForm = DOM.qs('#login-form');
  const usernameInput = DOM.qs('#login-username');
  const passwordInput = DOM.qs('#login-password');
  const togglePwBtn = DOM.qs('#btn-toggle-pw');
  const submitBtn = DOM.qs('#btn-login-submit');

  // Password Visibility Toggle
  if (togglePwBtn && passwordInput) {
    togglePwBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';

      const svg = togglePwBtn.querySelector('svg');
      if (svg) {
        svg.innerHTML = isPassword
          ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
          : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
      }
    });
  }

  function setLoadingState(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle('login-submit-btn--loading', isLoading);
    submitBtn.innerHTML = isLoading
      ? `
        <span>جاري التحقق والدخول...</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon">
          <line x1="12" y1="2" x2="12" y2="6"></line>
          <line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
          <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
          <line x1="2" y1="12" x2="6" y2="12"></line>
          <line x1="18" y1="12" x2="22" y2="12"></line>
        </svg>
      `
      : `
        <span>تسجيل الدخول</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      `;
  }

  // Perform User Authentication & Transition to Dashboard
  async function performLogin(email, password) {
    if (!email || !password) {
      showToast('من فضلك أدخل البريد الإلكتروني وكلمة المرور');
      return;
    }

    setLoadingState(true);
    let reloading = false;
    try {
      const { user } = await AuthService.login(email, password);

      // Full replace — a real server user object must not be merged with
      // whatever mock/previous-session fields happened to be lying around.
      store.replaceCurrentUser({
        name: user.fullName,
        roleLabel: ROLE_LABELS[user.role] || 'موظف',
        roleCode: user.role,
        email: user.email,
        id: user.id,
        // UX convenience only (§2.3) — permissions.js re-derives `can()` from
        // this, but the backend independently re-checks every call regardless.
        permissions: user.permissions || []
      });

      // Enrich with fresh profile data (avatar, phone, gender) immediately
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
        // Non-critical background fetch failure
      }

      // Data-loading components are not initialised while signed out — reload
      // into the app so they boot with the session (see startSignedInSession).
      // The spinner stays up until the page is replaced.
      reloading = true;
      const greeting = getTimeGreeting();
      startSignedInSession({
        message: `${greeting}، ${user.fullName}! تم تسجيل الدخول بدور (${ROLE_LABELS[user.role] || user.role}) بنجاح 🚀`
      });
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(LOGIN_ERROR_MESSAGES[err.code] || err.message);
      } else {
        showToast('تعذّر الوصول للخادم، تأكد من اتصالك بالإنترنت وحاول مرة أخرى');
      }
    } finally {
      if (!reloading) setLoadingState(false);
    }
  }

  // Update the dashboard hero greeting for the logged-in user.
  // بيانات الشريط الجانبي وإظهار أقسامه مسؤولية initSidebarUserProfile.
  function updateUserDOM(name) {
    const greetingEl = DOM.qs('.dash-hero-card__greeting');
    const nameEl = DOM.qs('.dash-hero-card__name');
    const heroTitle = DOM.qs('.dash-hero-card__title');
    const greeting = getTimeGreeting();

    if (greetingEl) greetingEl.textContent = greeting;
    if (nameEl) nameEl.textContent = name;
    if (!greetingEl && heroTitle) {
      heroTitle.innerHTML = `<span class="dash-hero-card__greeting">${greeting}</span>، <span class="dash-hero-card__name">${name}</span> 👋`;
    }
  }

  // Login Form Submission Event Handler
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      performLogin(email, password);
    });
  }

  // Quick Demo Account Shortcuts — fill the email only. The password is
  // never known client-side; the user still has to type it and submit.
  DOM.qsa('.btn-demo-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const demoEmail = chip.getAttribute('data-email');
      if (demoEmail && usernameInput) {
        usernameInput.value = demoEmail;
        if (passwordInput) passwordInput.focus();
      }
    });
  });

  // Listen for User Changes via EventBus
  EventBus.on(EVENTS.USER_CHANGED, (user) => {
    if (user && user.name) {
      updateUserDOM(user.name);
    }
  });

  // Apply stored user data on initial boot
  const initialUser = store.currentUser;
  if (initialUser && initialUser.name) {
    updateUserDOM(initialUser.name);
  }
}
