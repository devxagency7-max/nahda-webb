/* --------------------------------------------------------------------------
   CENTRAL ROLE & PERMISSION ENGINE
   Single source of truth for what each role is allowed to do. Components and
   the router ask this module instead of inspecting roleCode themselves, so a
   permission change is a one-line edit here.

   عند الربط بالباك إند: استبدل ROLE_PERMISSIONS بالصلاحيات القادمة من
   استجابة تسجيل الدخول — واجهة can() تفضل زي ما هي والمكوّنات ماتتلمسش.
   -------------------------------------------------------------------------- */
import { store } from '../state/store.js';

// أدوار الويب: مدير -> مراجع -> مدخل بيانات.
// الأخصائي الاجتماعي الميداني ليس دور دخول هنا — له تطبيق موبايل منفصل
// (مشروع nahda/ بـ Flutter) يكتب منه رأيه، والويب يعرضه للقراءة فقط.
// لكنه يفضل موجودًا كموظف في الجدول لأن الويب بيسند له الحالات.
export const ROLES = {
  MANAGER: 'manager',
  REVIEWER: 'reviewer',
  DATA_ENTRY: 'data_entry'
};

// دور بيانات فقط — لا يُسجَّل به الدخول في الويب
export const SOCIAL_WORKER_ROLE = 'social_worker';

export const ROLE_LABELS = {
  [ROLES.MANAGER]: 'مدير',
  [ROLES.REVIEWER]: 'مراجع',
  [ROLES.DATA_ENTRY]: 'مدخل بيانات',
  [SOCIAL_WORKER_ROLE]: 'أخصائي اجتماعي ميداني'
};

/* --------------------------------------------------------------------------
   PERMISSION CATALOGUE
   -------------------------------------------------------------------------- */
export const PERMISSIONS = {
  // Case data
  CREATE_CASE: 'create_case',
  VIEW_CASES: 'view_cases',
  EDIT_CASE: 'edit_case',

  // Reference data
  MANAGE_CHARITIES: 'manage_charities',
  MANAGE_LOCATIONS: 'manage_locations',

  // Opinions — each role owns exactly one slot and cannot write into another.
  // رأي الأخصائي بيتكتب من تطبيق الموبايل، فمفيش صلاحية كتابة له في الويب.
  WRITE_REVIEWER_OPINION: 'write_reviewer_opinion',
  WRITE_MANAGER_APPROVAL: 'write_manager_approval',
  VIEW_OPINIONS: 'view_opinions',

  // System administration
  VIEW_EMPLOYEES: 'view_employees',
  MANAGE_EMPLOYEES: 'manage_employees',
  // Reporting & Analytics
  VIEW_REPORTS: 'view_reports',
  VIEW_FINANCIAL_REPORTS: 'view_financial_reports',
  EXPORT_REPORTS: 'export_reports',

  // "ضبط بيانات الحالة" — dropdown-configs/options admin. data_entry-only
  // on the server as of the 2026-09-22 permissions change (was manager-only
  // in the original docs) — never assume the old table without re-checking.
  MANAGE_CONFIGURATIONS: 'manage_configurations',

  // "فلترة الحالات حسب الجمعية والدعم" — manager-only by product decision,
  // client-side gate only (view_cases still backs the underlying /search/cases
  // call server-side, same as every other case list screen).
  VIEW_CASE_SUPPORT_FILTER: 'view_case_support_filter'
};

/* --------------------------------------------------------------------------
   ROLE -> PERMISSIONS MATRIX
   كل دور محصور في خانة رأيه — المدير ماينفعش يكتب رأي الأخصائي أو المراجع.
   -------------------------------------------------------------------------- */
const ROLE_PERMISSIONS = {
  [ROLES.DATA_ENTRY]: [
    PERMISSIONS.CREATE_CASE,
    PERMISSIONS.VIEW_CASES,
    PERMISSIONS.EDIT_CASE,
    PERMISSIONS.MANAGE_CHARITIES,
    PERMISSIONS.MANAGE_LOCATIONS,
    PERMISSIONS.VIEW_OPINIONS,
    PERMISSIONS.MANAGE_CONFIGURATIONS,
    PERMISSIONS.VIEW_REPORTS
  ],

  [ROLES.REVIEWER]: [
    PERMISSIONS.CREATE_CASE,
    PERMISSIONS.VIEW_CASES,
    PERMISSIONS.EDIT_CASE,
    PERMISSIONS.MANAGE_CHARITIES,
    PERMISSIONS.MANAGE_LOCATIONS,
    PERMISSIONS.VIEW_OPINIONS,
    PERMISSIONS.WRITE_REVIEWER_OPINION,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_FINANCIAL_REPORTS,
    PERMISSIONS.EXPORT_REPORTS
  ],

  [ROLES.MANAGER]: [
    PERMISSIONS.CREATE_CASE,
    PERMISSIONS.VIEW_CASES,
    PERMISSIONS.EDIT_CASE,
    PERMISSIONS.MANAGE_CHARITIES,
    PERMISSIONS.MANAGE_LOCATIONS,
    PERMISSIONS.VIEW_OPINIONS,
    PERMISSIONS.WRITE_MANAGER_APPROVAL,
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.MANAGE_EMPLOYEES,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_FINANCIAL_REPORTS,
    PERMISSIONS.EXPORT_REPORTS,
    PERMISSIONS.VIEW_CASE_SUPPORT_FILTER
  ]
};

/* --------------------------------------------------------------------------
   VIEW ACCESS MAP
   الشاشات غير المذكورة هنا متاحة لكل الأدوار (لوحة التحكم، الحالات، الملف
   الشخصي...). المذكورة بتحتاج الصلاحية المقابلة.
   -------------------------------------------------------------------------- */
const VIEW_PERMISSIONS = {
  employees: PERMISSIONS.VIEW_EMPLOYEES,
  reports: PERMISSIONS.VIEW_REPORTS,
  'case-support-filter': PERMISSIONS.VIEW_CASE_SUPPORT_FILTER,
  charities: PERMISSIONS.MANAGE_CHARITIES,
  // Gates the whole page by its locations card (every role has this).
  // The dropdown-protocol CRUD card inside the same page is gated
  // separately, by MANAGE_CONFIGURATIONS, in the component itself —
  // it's a stricter, data_entry-only permission.
  'state-mgmt': PERMISSIONS.MANAGE_LOCATIONS,
  'personal-data': PERMISSIONS.CREATE_CASE
};

/** شاشات مخفية عن دور المدير بالكامل. */
const MANAGER_HIDDEN_VIEWS = ['state-mgmt', 'charities'];

/* --------------------------------------------------------------------------
   PUBLIC API
   -------------------------------------------------------------------------- */

/** Is this one of the roles allowed to sign in on the web? */
export function isWebRole(roleCode) {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roleCode);
}

/**
 * Current user's role code, or null when nobody is signed in or the stored
 * role is unknown. There is deliberately NO fallback role: an unrecognised
 * role means an invalid session, and can() denies everything for it.
 */
export function currentRole() {
  const code = store.currentUser && store.currentUser.roleCode;
  return isWebRole(code) ? code : null;
}

/**
 * Does the current user hold this permission?
 *
 * Prefers the `permissions` array the backend sends on login/`/auth/me`
 * (WEB_API_DOCUMENTATION.md §2.3 — the authoritative, per-account grant list).
 * Falls back to the static ROLE_PERMISSIONS matrix only when a session has
 * no such array yet (e.g. mid-migration, or a not-yet-logged-in mock state).
 *
 * Note per the docs: this is still only a UX gate — the backend independently
 * re-checks every permission server-side on every request regardless of what
 * this returns.
 * @param {string} permission - a value from PERMISSIONS
 */
export function can(permission) {
  const role = currentRole();
  if (!role) return false;
  const serverGranted = store.currentUser && store.currentUser.permissions;
  if (Array.isArray(serverGranted)) {
    if (serverGranted.includes(permission)) return true;
    if (role === ROLES.MANAGER) {
      if (permission === PERMISSIONS.VIEW_CASE_SUPPORT_FILTER) return true;
    }
    if (role === ROLES.MANAGER || role === ROLES.REVIEWER) {
      if (permission === PERMISSIONS.VIEW_REPORTS || permission === PERMISSIONS.VIEW_FINANCIAL_REPORTS || permission === PERMISSIONS.EXPORT_REPORTS) {
        return true;
      }
    } else if (role === ROLES.DATA_ENTRY) {
      if (permission === PERMISSIONS.VIEW_REPORTS) return true;
    }
    return false;
  }
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Is the current user allowed to open this view?
 * @param {string} viewName - the router view key
 */
export function canAccessView(viewName) {
  // قرار منتج: المدير مايشوفش «إدارة بيانات الحالة» ولا «إدارة الجمعيات» (لا في الشريط
  // الجانبي ولا بفتح الشاشة مباشرة)، بغض النظر عن الصلاحيات اللي راجعة من الباك إند.
  if (MANAGER_HIDDEN_VIEWS.includes(viewName) && currentRole() === ROLES.MANAGER) return false;
  const required = VIEW_PERMISSIONS[viewName];
  return required ? can(required) : true;
}

/** Arabic label for a role code, for display purposes. */
export function roleLabel(roleCode) {
  return ROLE_LABELS[roleCode] || 'موظف';
}

/** Convenience helpers for the few places that read the role directly. */
export function isRole(roleCode) {
  return currentRole() === roleCode;
}

/* --------------------------------------------------------------------------
   APPROVAL SEQUENCE
   المسار الطبيعي: رأي الأخصائي (من تطبيق الموبايل) -> رأي المراجع -> اعتماد
   المدير. المراجع مقيَّد بانتظار رأي الأخصائي، أما المدير ففوق التسلسل ويقدر
   يحسم الملف في أي وقت. بعد الاعتماد النهائي تتقفل الآراء كلها (بيانات الحالة
   نفسها بتفضل قابلة للتعديل).
   -------------------------------------------------------------------------- */

/** Has the field social worker recorded their opinion (via the mobile app)? */
export function hasWorkerOpinion(caseObj) {
  const op = caseObj && caseObj.workerOpinion;
  return Boolean(op && op.decision);
}

/**
 * Has the reviewer SUBMITTED their opinion to the manager?
 * رأي محفوظ كمسودة (submitted !== true) لسه شغل المراجع — مايفتحش خانة
 * المدير ومايخرجش الحالة من قائمة المراجعة.
 */
export function hasReviewerOpinion(caseObj) {
  const op = caseObj && caseObj.reviewerOpinion;
  return Boolean(op && op.decision && op.submitted);
}

/** Does a reviewer draft exist (saved but not yet sent to the manager)? */
export function hasReviewerDraft(caseObj) {
  const op = caseObj && caseObj.reviewerOpinion;
  return Boolean(op && op.decision && !op.submitted);
}

/** Has the manager given the final approval? */
export function hasManagerApproval(caseObj) {
  const op = caseObj && caseObj.managerApproval;
  return Boolean(op && op.decision);
}

/**
 * Can the current user write into a given opinion slot right now?
 * Combines three rules: the role owns the slot, the preceding slot is filled,
 * and the case is not locked by a final approval.
 *
 * @param {string} slot - 'worker' | 'reviewer' | 'manager'
 * @param {object} caseObj
 * @returns {{allowed: boolean, reason: string}} reason is Arabic, for the UI
 */
export function canWriteOpinion(slot, caseObj) {
  if (slot === 'worker') {
    return { allowed: false, reason: 'رأي الأخصائي يُسجَّل من تطبيق الأخصائي الميداني' };
  }

  if (hasManagerApproval(caseObj)) {
    return { allowed: false, reason: 'تم اعتماد الحالة نهائيًا — الآراء مقفولة' };
  }

  if (slot === 'reviewer') {
    if (!can(PERMISSIONS.WRITE_REVIEWER_OPINION)) {
      return { allowed: false, reason: 'هذه الخانة من صلاحيات المراجع وحده' };
    }
    if (!hasWorkerOpinion(caseObj)) {
      return { allowed: false, reason: 'في انتظار رأي الأخصائي الميداني أولًا' };
    }
    return { allowed: true, reason: '' };
  }

  if (slot === 'manager') {
    if (!can(PERMISSIONS.WRITE_MANAGER_APPROVAL)) {
      return { allowed: false, reason: 'الاعتماد النهائي من صلاحيات المدير وحده' };
    }
    // المدير فوق التسلسل: يقدر يحسم الملف في أي وقت حتى قبل رأي المراجع.
    // القيد الوحيد عليه هو ألا يعتمد ملفًا محسومًا بالفعل (الشرط أعلاه).
    return { allowed: true, reason: '' };
  }

  return { allowed: false, reason: '' };
}
