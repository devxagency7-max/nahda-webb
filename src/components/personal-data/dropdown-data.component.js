/* --------------------------------------------------------------------------
   DROPDOWN DATA BOOTSTRAP FOR THE PERSONAL-DATA WIZARD
   Replaces the wizard's static HTML <option> lists with the real values
   configured in "إدارة بيانات الحالة" (state-data-management.component.js),
   by calling the consumption route GET /dropdowns/{key} for each key below.
   Must run once, at bootstrap, BEFORE initOtherOptionDropdowns() — that
   module decides whether to attach the "أخرى" free-text behavior based on
   the <select>'s current options/attributes, so it needs the real list in
   place first, not the placeholder HTML markup.

   The five location/charity keys (district, village, referral-district-
   select, referral-village-select, referral-charity-select) are NOT here —
   those are cascading pickers already wired to LocationsService/store via
   location-cascade.component.js and go through /locations, not this route.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { DropdownsService } from '../../services/dropdowns.service.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';

// key (dropdown-configs key, confirmed live with the backend on 2026-09-22)
// -> the <select> id it populates. Where a key's id differs from the key
// itself, it's because the HTML field id predates this key naming.
const KEY_TO_SELECT_ID = {
  'gender': 'gender',
  'religion': 'religion',
  'head-relation': 'head-relation',
  'education-level': 'education-level',
  'governorate': 'governorate',
  'work-type': 'work-type',
  'social-insurance': 'social-insurance',
  'new-member-relation': 'new-member-relation',
  'new-member-gender': 'new-member-gender',
  'new-member-religion': 'new-member-religion',
  'new-member-education-stage': 'new-member-education-stage',
  'new-member-qualification': 'new-member-qualification',
  'agri-land-type': 'agri-land-type',
  'income-type': 'new-income-type',
  'income-frequency': 'new-income-frequency',
  'expense-type': 'new-expense-type',
  'expense-frequency': 'new-expense-frequency',
  'researcher-brief-opinion': 'researcher-brief-opinion'
};

/** Populates one <select> from its GET /dropdowns/{key} options, keeping the placeholder option and any prior default selection. */
function populateSelect(select, options) {
  const placeholder = select.querySelector('option[value=""]');
  const previousSelected = select.querySelector('option[selected]:not([value=""])');
  const previousValue = previousSelected ? previousSelected.value : null;

  Array.from(select.options).forEach(opt => {
    if (opt !== placeholder) opt.remove();
  });

  const sorted = [...options].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  sorted.forEach(opt => {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.isOther) optionEl.dataset.isOther = 'true';
    select.appendChild(optionEl);
  });

  if (previousValue && sorted.some(o => o.value === previousValue)) {
    select.value = previousValue;
  }
}

/** Refetches one key and repopulates its <select>, if that key maps to one on this page. */
async function refreshOne(key) {
  const selectId = KEY_TO_SELECT_ID[key];
  if (!selectId) return;
  const select = DOM.qs(`#${selectId}`);
  if (!select) return;

  try {
    // The admin mutation that triggered this already cleared the service's
    // cache, so this is a real network hit, not a stale in-memory read.
    const { options } = await DropdownsService.getOptions(key);
    populateSelect(select, options || []);
  } catch {
    // Leave the select as-is rather than emptying a live form field.
  }
}

let listenerRegistered = false;

export async function initDropdownData() {
  const entries = Object.entries(KEY_TO_SELECT_ID);

  await Promise.all(entries.map(([key]) => refreshOne(key)));

  // Live refresh: an admin adding/editing/deactivating an option in
  // "إدارة بيانات الحالة" (same tab, same session) should not require a
  // full page reload to show up here.
  if (!listenerRegistered) {
    EventBus.on(EVENTS.DROPDOWN_OPTIONS_UPDATED, ({ key } = {}) => {
      if (key) refreshOne(key);
    });
    listenerRegistered = true;
  }
}
