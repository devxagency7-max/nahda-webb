/* --------------------------------------------------------------------------
   APPLICATION BOOTSTRAPPER & LIFECYCLE CONTROLLER
   Orchestrates application initialization, module bootstrapping, and cleanup.
   -------------------------------------------------------------------------- */
import { mountComponentTemplates } from './loader.js';
import { initPageViewNavigation } from './router.js';
import { initDashboardInteractivity } from '../components/dashboard/dashboard.component.js';
import { initSidebarAccordion, initSidebarCollapse, initSidebarUserProfile } from '../components/sidebar/sidebar.component.js';
import { initWorkflowTabs } from '../components/workflow/workflow.component.js';
import { initInPageBackgroundStudio } from '../components/bg-studio/bg-studio.component.js';
import { initFileUpload } from '../components/file-upload/file-upload.component.js';
import { initFamilyMembersManager } from '../components/family-members/family-members.component.js';
import { initLocationCascade } from '../components/location-cascade/location-cascade.component.js';
import { initDropdownData } from '../components/personal-data/dropdown-data.component.js';
import { initReferenceDataSync } from './reference-sync.js';
import { initOtherOptionDropdowns } from '../components/other-dropdowns/other-dropdowns.component.js';
import { initChipFields } from '../components/chip-field/chip-field.component.js';
import { initAgricultureManager } from '../components/agriculture/agriculture.component.js';
import { initSupportManager } from '../components/support/support.component.js';
import { initFinancialManager } from '../components/financial-ledger/financial-ledger.component.js';
import { initLoginScreen } from '../components/login/login.component.js';
import { initStateDataManagement } from '../components/state-data-management/state-data-management.component.js';
import { initCharitiesManager } from '../components/charities/charities.component.js';
import { initEmployeesManager } from '../components/employees/employees.component.js';
import { initProfileComponent } from '../components/profile/profile.component.js';
import { initAllCasesComponent } from '../components/all-cases/all-cases.component.js';
import { initCaseDetailsComponent } from '../components/case-details/case-details.component.js';
import { initReportsComponent } from '../components/reports/reports.component.js';
import { initSystemBackups } from '../components/system-backups/system-backups.component.js';
import { initCaseSupportFilterComponent } from '../components/case-support-filter/case-support-filter.component.js';
import { initNotifications } from '../components/notifications/notifications.component.js';
import { Lifecycle } from './lifecycle.js';
import { initNumericInputNormalization } from '../utils/numeric-inputs.js';
import { initDialogA11y, initToggleStateA11y, initDisclosureA11y } from '../utils/a11y.js';
import { showToast } from '../utils/toast.js';
import { TokenStore } from '../services/tokens.js';

export function bootstrapApp() {
  document.addEventListener('DOMContentLoaded', async () => {
    // أي initializer بيفشل بيتسجّل هنا. قبل كده الـ 26 نداء كانوا تعليمات
    // عادية جوه هاندلر async من غير try/catch، فأول throw كان بيوقف كل
    // اللي بعده في صمت (رفض promise مش مسموع) — خطأ في مكوّن واحد كان
    // بيعطّل التطبيق بالكامل. العزل هدفه إن المكوّن العاطل يهبط لوحده.
    const bootstrapFailures = [];

    /**
     * ينفّذ initializer واحد معزولًا. بيحافظ على نفس التوقيت الأصلي بالظبط:
     * لو الدالة متزامنة مابيرجّعش promise (فمفيش microtask tick زيادة بين
     * الـ initializers)، ولو رجّعت promise بيرجّعه للمنادي يعمل await لو
     * محتاج — زي ما كان initDropdownData بالظبط.
     * الخطأ بيتسجّل كما هو: العزل مش إخفاء أعطال.
     * @param {string} name
     * @param {Function} fn
     * @returns {Promise<void>|undefined}
     */
    function runInit(name, fn) {
      const record = (err) => {
        console.error(`[bootstrap] initializer "${name}" failed:`, err);
        bootstrapFailures.push({ name, error: err });
      };
      try {
        const result = fn();
        if (result && typeof result.then === 'function') {
          return result.then(undefined, record);
        }
      } catch (err) {
        record(err);
      }
      return undefined;
    }

    // 1. Synchronously mount modular HTML component templates into App Shell DOM
    mountComponentTemplates();

    // 1.5. Decide the session/view FIRST, before any authenticated network
    // call goes out. initDropdownData() below fires ~18 parallel /dropdowns
    // requests — if it ran first and one of them 401'd on an expired access
    // token, http.js's forceLogout() would clear the session and emit
    // SESSION_EXPIRED before this listener even existed to catch it,
    // silently dumping the user back on the login screen with no toast.
    // Registering the listener (and running the hasSession boot-guard) here
    // first closes that race.
    runInit('pageViewNavigation', initPageViewNavigation);

    // Without a session every data-loading initializer below would just fire
    // its requests and collect a 401 each (~28 of them, 17 awaited) — slow
    // first paint for the login screen, pointless load on the API and, for
    // list screens, an error painted as "no results". So they only run when a
    // session exists. A successful login reloads the page (see login.component
    // -> startSignedInSession), which boots this again WITH a session and runs
    // them exactly as a signed-in refresh always has.
    // Evaluated after pageViewNavigation, whose boot guard sweeps a dead session.
    const signedIn = TokenStore.hasSession();
    const runDataInit = (name, fn) => (signedIn ? runInit(name, fn) : undefined);

    // 1.6. Reference data (dropdown options, centers/villages, charities)
    // comes from the localStorage cache first — see services/reference-data.js.
    // referenceDataSync hydrates the store's locations before the screens
    // below read them, and starts the background version check.
    runDataInit('referenceDataSync', initReferenceDataSync);

    // 1.7. Populate the personal-data wizard's <select> options (cached, or
    // GET /dropdowns/{key} on a cold cache). Not awaited: nothing below
    // depends on it anymore — other-dropdowns.component.js looks up the
    // "أخرى" option live, and case-edit.loader.js awaits whenDropdownsReady()
    // itself — so a slow API no longer holds up the rest of the boot.
    runDataInit('dropdownData', initDropdownData);

    // 2. Initialize application interactive controllers & event listeners
    // (runDataInit = talks to the API on init; the rest are DOM-only.)
    runInit('loginScreen', initLoginScreen);
    runDataInit('dashboardInteractivity', initDashboardInteractivity);
    runInit('sidebarAccordion', initSidebarAccordion);
    runInit('sidebarCollapse', initSidebarCollapse);
    runInit('sidebarUserProfile', initSidebarUserProfile);
    runDataInit('workflowTabs', initWorkflowTabs);
    runInit('fileUpload', initFileUpload);
    runInit('inPageBackgroundStudio', initInPageBackgroundStudio);
    runInit('familyMembersManager', initFamilyMembersManager);
    runDataInit('locationCascade', initLocationCascade);
    runInit('otherOptionDropdowns', initOtherOptionDropdowns);
    runInit('chipFields', initChipFields);
    runInit('agricultureManager', initAgricultureManager);
    runInit('supportManager', initSupportManager);
    runInit('financialManager', initFinancialManager);
    runDataInit('stateDataManagement', initStateDataManagement);
    runDataInit('charitiesManager', initCharitiesManager);
    runDataInit('employeesManager', initEmployeesManager);
    runDataInit('profileComponent', initProfileComponent);
    runDataInit('allCasesComponent', initAllCasesComponent);
    runDataInit('caseDetailsComponent', initCaseDetailsComponent);
    runDataInit('reportsComponent', initReportsComponent);
    runDataInit('caseSupportFilterComponent', initCaseSupportFilterComponent);
    runDataInit('systemBackups', initSystemBackups);
    runDataInit('notifications', initNotifications);
    runInit('numericInputNormalization', initNumericInputNormalization);
    runInit('dialogA11y', initDialogA11y);
    runInit('toggleStateA11y', initToggleStateA11y);
    runInit('disclosureA11y', initDisclosureA11y);

    // 3. لو أي مكوّن فشل، المستخدم لازم يعرف إن الشاشة مش كاملة بدل ما
    //    يكتشف بنفسه إن زرار مش شغال. التفاصيل التقنية في console.error فوق.
    if (bootstrapFailures.length > 0) {
      showToast('بعض أجزاء التطبيق لم تُحمَّل بشكل صحيح — يرجى تحديث الصفحة', 'warning');
    }
  });

  // Handle unload lifecycle cleanup
  window.addEventListener('beforeunload', () => {
    Lifecycle.destroy();
  });
}
