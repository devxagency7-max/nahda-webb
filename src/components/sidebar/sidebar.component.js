/* --------------------------------------------------------------------------
   SIDEBAR COMPONENT
   Handles accordion navigation groups and sidebar collapse state.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { store } from '../../state/store.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { can, canAccessView, PERMISSIONS, roleLabel, currentRole, ROLES } from '../../core/permissions.js';
import { setExpanded } from '../../utils/a11y.js';

export function initSidebarAccordion() {
  const accordionHeaders = DOM.qsa('.accordion-header');

  // Initialize initially open accordions
  DOM.qsa('.accordion-group--open').forEach(group => {
    const body = group.querySelector('.accordion-body');
    if (body) body.style.maxHeight = (body.scrollHeight + 40) + 'px';
  });

  // كل header بيفتح body لازم يعلن حالته (aria-expanded) ويشاور على المحتوى (aria-controls).
  const syncAccordionAria = () => {
    accordionHeaders.forEach(header => {
      const group = header.closest('.accordion-group');
      const body = group?.querySelector('.accordion-body');
      if (!body) return;
      setExpanded(header, body, group.classList.contains('accordion-group--open'));
    });
  };
  syncAccordionAria();

  accordionHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      // If header is a direct link (e.g. <a> anchor or direct data-view-target link), don't treat as expandable accordion header
      if (header.tagName === 'A' || header.id === 'nav-bg-card-link' || header.id === 'nav-employees-link' || header.id === 'nav-reports-link' || header.id === 'nav-case-support-filter-link' || header.id === 'nav-system-backups-link' || header.id === 'nav-dashboard-link' || !header.closest('.accordion-group')?.querySelector('.accordion-body')) {
        return;
      }

      e.preventDefault();
      const group = header.closest('.accordion-group');
      if (!group) return;
      const body = group.querySelector('.accordion-body');
      if (!body) return;

      const isOpen = group.classList.contains('accordion-group--open');

      // Close all other accordions for clean single navigation
      DOM.qsa('.accordion-group').forEach(otherGroup => {
        if (otherGroup !== group && otherGroup.classList.contains('accordion-group--open')) {
          otherGroup.classList.remove('accordion-group--open');
          const otherBody = otherGroup.querySelector('.accordion-body');
          if (otherBody) otherBody.style.maxHeight = null;
        }
      });

      // Toggle current accordion
      if (isOpen) {
        group.classList.remove('accordion-group--open');
        body.style.maxHeight = null;
      } else {
        group.classList.add('accordion-group--open');
        body.style.maxHeight = (body.scrollHeight + 40) + 'px';
      }
      syncAccordionAria();
    });
  });
}

export function initSidebarCollapse() {
  const sidebar = DOM.qs('.sidebar');
  const toggleBtn = DOM.qs('.sidebar__toggle');
  const sidebarNav = DOM.qs('.sidebar__nav');

  function setCollapsed(collapsed, save = true) {
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar--collapsed', collapsed);
    document.body.classList.toggle('sidebar-is-collapsed', collapsed);

    const icon = toggleBtn ? toggleBtn.querySelector('svg') : null;
    if (icon) {
      icon.style.transform = collapsed ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    if (save) {
      try {
        localStorage.setItem('nahda_sidebar_collapsed', collapsed ? 'true' : 'false');
      } catch (e) {}
    }

    // Trigger resize event for dynamic layout reflow
    window.dispatchEvent(new Event('resize'));
  }

  // Restore saved sidebar collapsed preference
  try {
    const isSavedCollapsed = localStorage.getItem('nahda_sidebar_collapsed') === 'true';
    if (isSavedCollapsed) {
      setCollapsed(true, false);
    }
  } catch (e) {}

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCollapsed(!sidebar.classList.contains('sidebar--collapsed'));
    });
  }

  // Expand the sidebar automatically when any nav button is clicked while collapsed
  if (sidebarNav && sidebar) {
    sidebarNav.addEventListener('click', (e) => {
      if (e.target.closest('.accordion-header') || e.target.closest('.sidebar-sublink')) {
        if (sidebar.classList.contains('sidebar--collapsed')) {
          setCollapsed(false);
        }
      }
    });
  }
}

export function initSidebarUserProfile() {
  const avatarImg = DOM.qs('#sidebar-user-avatar');
  const nameEl = DOM.qs('#sidebar-user-name');
  const roleEl = DOM.qs('#sidebar-user-role');

  function update() {
    // store.currentUser === null حالة صحيحة ومقصودة، مش خطأ: معناها مفيش
    // مستخدم مسجَّل دخوله (شاشة الدخول، أو بعد تسجيل خروج/انتهاء جلسة —
    // راجع clearCurrentUser في state/store.js و router.js). فمابنقراش منها
    // أي خاصية من غير تحقق، وبنرسم "حالة بدون مستخدم" بدل ما نستبدلها
    // بمستخدم افتراضي وهمي. بوابات الصلاحيات تحت لازم تفضل تشتغل في
    // الحالتين — هي اللي بتخفي أقسام التنقّل الخاصة بالأدوار.
    const user = store.currentUser;
    const isSignedIn = Boolean(user);
    const defaultAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
    if (avatarImg) avatarImg.src = (isSignedIn && user.avatar) || defaultAvatar;
    if (nameEl) {
      if (!isSignedIn) nameEl.textContent = '';
      else if (user.name) nameEl.textContent = user.name;
    }
    // الاسم المعروض يُشتق من roleCode لا من roleLabel المخزَّن، فلو الجلسة
    // المحفوظة قديمة أو ناقصة يفضل المعروض مطابقًا للصلاحيات الفعلية.
    if (roleEl) roleEl.textContent = isSignedIn ? roleLabel(currentRole()) : '';

    // Hide navigation entries the current role has no permission to open
    const employeesGroup = DOM.qs('#sidebar-employees-group, #nav-employees-group');
    if (employeesGroup) {
      employeesGroup.style.display = can(PERMISSIONS.VIEW_EMPLOYEES) ? 'block' : 'none';
    }

    const reportsGroup = DOM.qs('#sidebar-reports-group, #nav-reports-group');
    if (reportsGroup) {
      const isUserAdmin = currentRole() === ROLES.MANAGER || currentRole() === 'admin' || can(PERMISSIONS.VIEW_EMPLOYEES);
      reportsGroup.style.display = isUserAdmin ? 'block' : 'none';
    }

    // «إدارة بيانات الحالة» و«إدارة الجمعيات» — مخفيين عن دور المدير (قرار المنتج).
    // الحجب الفعلي للشاشتين كمان في canAccessView جوه permissions.js.
    DOM.qsa('.sidebar-sublink[data-view-target="state-mgmt"], .sidebar-sublink[data-view-target="charities"]').forEach(link => {
      link.style.display = canAccessView(link.dataset.viewTarget) ? '' : 'none';
    });

    // "فلترة الحالات بالدعم" — manager-only (per product decision, narrower
    // than the general reports/view_reports permission).
    const systemBackupsGroup = DOM.qs('#sidebar-system-backups-group');
    if (systemBackupsGroup) {
      systemBackupsGroup.style.display = can(PERMISSIONS.DOWNLOAD_SYSTEM_BACKUP) ? 'block' : 'none';
    }

    const caseSupportFilterGroup = DOM.qs('#sidebar-case-support-filter-group');
    if (caseSupportFilterGroup) {
      caseSupportFilterGroup.style.display = currentRole() === ROLES.MANAGER ? 'block' : 'none';
    }
  }

  update();
  EventBus.on(EVENTS.USER_CHANGED, update);
}
