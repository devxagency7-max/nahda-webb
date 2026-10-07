/* --------------------------------------------------------------------------
   CENTRAL DOM COMPONENT LOADER
   Imports modular HTML template components using Vite ?raw imports and
   synchronously mounts them into container elements in the DOM before
   application interactivity bootstrapper runs.
   -------------------------------------------------------------------------- */

// Layout Components
import sidebarHtml from '../components/layout/sidebar/sidebar.html?raw';
import headerHtml from '../components/layout/header/header.html?raw';

// Login View
import loginHtml from '../components/login/login.html?raw';

// Dashboard View & Sub-Parts
import dashHeroHtml from '../components/dashboard/parts/dash-hero.html?raw';
import dashSearchHtml from '../components/dashboard/parts/dash-search.html?raw';
import dashKpisHtml from '../components/dashboard/parts/dash-kpis.html?raw';
import dashRecentCasesHtml from '../components/dashboard/parts/dash-recent-cases.html?raw';
import dashboardHtml from '../components/dashboard/dashboard.html?raw';

// Workflow & Personal Data 8-Step Panes
import workflowNavHtml from '../components/workflow/workflow-nav.html?raw';
import step1Html from '../components/personal-data/steps/step1-demographics.html?raw';
import step2Html from '../components/personal-data/steps/step2-attachments.html?raw';
import step3Html from '../components/personal-data/steps/step3-housing.html?raw';
import step4Html from '../components/personal-data/steps/step4-utilities.html?raw';
import step5Html from '../components/personal-data/steps/step5-agriculture.html?raw';
import step6Html from '../components/personal-data/steps/step6-financial.html?raw';
import step7Html from '../components/personal-data/steps/step7-support.html?raw';
import step8Html from '../components/personal-data/steps/step8-assessment.html?raw';
import personalDataHtml from '../components/personal-data/personal-data.html?raw';

// Background Studio View
import bgStudioHtml from '../components/background-studio/bg-studio.html?raw';

// State Data Management Modal View
import stateDataMgmtHtml from '../components/state-data-management/state-data-management.html?raw';

// Charities Management View
import charitiesHtml from '../components/charities/charities.html?raw';

// Employees Management View (for Manager & Admin)
import employeesHtml from '../components/employees/employees.html?raw';

// Edit Profile View
import profileHtml from '../components/profile/profile.html?raw';

// All Cases View
import allCasesHtml from '../components/all-cases/all-cases.html?raw';

// Case Details Page View
import caseDetailsHtml from '../components/case-details/case-details.html?raw';

// Reports Page View
import reportsHtml from '../components/reports/reports.html?raw';

// Case Support Filter Page View (manager-only)
import caseSupportFilterHtml from '../components/case-support-filter/case-support-filter.html?raw';

// System Backups Page View (manager-only)
import systemBackupsHtml from '../components/system-backups/system-backups.html?raw';

/**
 * Synchronously mounts all modular HTML component templates into the DOM.
 */
export function mountComponentTemplates() {
  // 1. Sidebar & Header Mount
  const sidebarContainer = document.getElementById('sidebar-mount');
  if (sidebarContainer) sidebarContainer.outerHTML = sidebarHtml;

  const headerContainer = document.getElementById('header-mount');
  if (headerContainer) headerContainer.outerHTML = headerHtml;

  // 2. Main Page Views Mount
  const loginContainer = document.getElementById('login-view-mount');
  if (loginContainer) loginContainer.outerHTML = loginHtml;

  const dashboardContainer = document.getElementById('dashboard-view-mount');
  if (dashboardContainer) {
    dashboardContainer.outerHTML = dashboardHtml;

    // Sub-parts of Dashboard
    const heroMount = document.getElementById('dash-hero-mount');
    if (heroMount) heroMount.outerHTML = dashHeroHtml;

    const searchMount = document.getElementById('dash-search-mount');
    if (searchMount) searchMount.outerHTML = dashSearchHtml;

    const kpisMount = document.getElementById('dash-kpis-mount');
    if (kpisMount) kpisMount.outerHTML = dashKpisHtml;

    const recentCasesMount = document.getElementById('dash-recent-cases-mount');
    if (recentCasesMount) recentCasesMount.outerHTML = dashRecentCasesHtml;
  }

  const personalDataContainer = document.getElementById('personal-data-view-mount');
  if (personalDataContainer) {
    personalDataContainer.outerHTML = personalDataHtml;

    // Sub-parts of Personal Data & Steps
    const navMount = document.getElementById('workflow-nav-mount');
    if (navMount) navMount.outerHTML = workflowNavHtml;

    const s1Mount = document.getElementById('step-pane-1-mount');
    if (s1Mount) s1Mount.outerHTML = step1Html;

    const s2Mount = document.getElementById('step-pane-2-mount');
    if (s2Mount) s2Mount.outerHTML = step2Html;

    const s3Mount = document.getElementById('step-pane-3-mount');
    if (s3Mount) s3Mount.outerHTML = step3Html;

    const s4Mount = document.getElementById('step-pane-4-mount');
    if (s4Mount) s4Mount.outerHTML = step4Html;

    const s5Mount = document.getElementById('step-pane-5-mount');
    if (s5Mount) s5Mount.outerHTML = step5Html;

    const s6Mount = document.getElementById('step-pane-6-mount');
    if (s6Mount) s6Mount.outerHTML = step6Html;

    const s7Mount = document.getElementById('step-pane-7-mount');
    if (s7Mount) s7Mount.outerHTML = step7Html;

    const s8Mount = document.getElementById('step-pane-8-mount');
    if (s8Mount) s8Mount.outerHTML = step8Html;
  }

  const bgStudioContainer = document.getElementById('bg-studio-view-mount');
  if (bgStudioContainer) bgStudioContainer.outerHTML = bgStudioHtml;

  const stateDataMgmtContainer = document.getElementById('state-data-mgmt-mount');
  if (stateDataMgmtContainer) stateDataMgmtContainer.outerHTML = stateDataMgmtHtml;

  const charitiesContainer = document.getElementById('charities-view-mount');
  if (charitiesContainer) charitiesContainer.outerHTML = charitiesHtml;

  const employeesContainer = document.getElementById('employees-view-mount');
  if (employeesContainer) employeesContainer.outerHTML = employeesHtml;

  const profileContainer = document.getElementById('profile-view-mount');
  if (profileContainer) profileContainer.outerHTML = profileHtml;

  const allCasesContainer = document.getElementById('all-cases-view-mount');
  if (allCasesContainer) allCasesContainer.outerHTML = allCasesHtml;

  const caseDetailsContainer = document.getElementById('case-details-view-mount');
  if (caseDetailsContainer) caseDetailsContainer.outerHTML = caseDetailsHtml;

  const reportsContainer = document.getElementById('reports-view-mount');
  if (reportsContainer) reportsContainer.outerHTML = reportsHtml;

  const caseSupportFilterContainer = document.getElementById('case-support-filter-view-mount');
  if (caseSupportFilterContainer) caseSupportFilterContainer.outerHTML = caseSupportFilterHtml;

  const systemBackupsContainer = document.getElementById('system-backups-view-mount');
  if (systemBackupsContainer) systemBackupsContainer.outerHTML = systemBackupsHtml;
}
