/* --------------------------------------------------------------------------
   DROPDOWN DATA BOOTSTRAP FOR THE PERSONAL-DATA WIZARD
   Replaces the wizard's static HTML <option> lists with the real values
   configured in "إدارة بيانات الحالة" (state-data-management.component.js),
   by calling the consumption route GET /dropdowns/{key} for each key below.
   Options come from the localStorage reference cache when available (no
   request), and are re-populated in place whenever the server reports a key
   changed (EVENTS.REFERENCE_DATA_CHANGED) or an admin edits it in this tab
   (EVENTS.DROPDOWN_OPTIONS_UPDATED). Repopulating keeps the user's current
   selection and any "أخرى" option other-dropdowns.component.js relies on.

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

/**
 * Populates one <select> from its GET /dropdowns/{key} options, keeping the
 * placeholder option and the current (or default) selection. Can run again
 * on a live form (background refresh), so it must not drop what the user
 * picked or a custom "أخرى" value they typed.
 */
function populateSelect(select, options) {
  const placeholder = select.querySelector('option[value=""]');
  // First fill: only the markup's explicit default counts (select.value would
  // just be whichever static placeholder option happens to come first).
  // Later fills: the live value, i.e. whatever the user has picked.
  const isRefill = select.dataset.optionsLoaded === 'true';
  const previousDefault = select.querySelector('option[selected]:not([value=""])');
  const previousValue = isRefill ? select.value : (previousDefault ? previousDefault.value : '');

  const sorted = [...options].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  // The server list has no "أخرى" of its own: keep the one already on the
  // select (added by other-dropdowns.component.js, possibly holding a typed
  // custom value) instead of deleting it.
  const keptOther = sorted.some(o => o.isOther) ? null : select.querySelector('option[data-is-other="true"]');

  Array.from(select.options).forEach(opt => {
    if (opt !== placeholder && opt !== keptOther) opt.remove();
  });

  sorted.forEach(opt => {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.isOther) optionEl.dataset.isOther = 'true';
    select.insertBefore(optionEl, keptOther);
  });

  if (previousValue && Array.from(select.options).some(o => o.value === previousValue)) {
    select.value = previousValue;
  }
  select.dataset.optionsLoaded = 'true';

  // The picked option no longer exists (deactivated on the server) — let
  // listeners (e.g. the "أخرى" inline input) resync with the reset select.
  if (isRefill && select.value !== previousValue) {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/** Refetches one key and repopulates its <select>, if that key maps to one on this page. */
async function refreshOne(key) {
  const selectId = KEY_TO_SELECT_ID[key];
  if (!selectId) return;
  const select = DOM.qs(`#${selectId}`);
  if (!select) return;

  try {
    // Served from the reference cache unless it's missing or stale (an admin
    // mutation clears it; a version change marks it stale) — then fetched.
    const { options } = await DropdownsService.getOptions(key);
    populateSelect(select, options || []);
  } catch {
    // Leave the select as-is rather than emptying a live form field.
  }
}

let initialLoad = null;

export function initDropdownData() {
  if (initialLoad) return initialLoad;

  initialLoad = Promise.all(Object.keys(KEY_TO_SELECT_ID).map(refreshOne));

  // Live refresh: an admin adding/editing/deactivating an option in
  // "إدارة بيانات الحالة" (same tab, same session) should not require a
  // full page reload to show up here.
  EventBus.on(EVENTS.DROPDOWN_OPTIONS_UPDATED, ({ key } = {}) => {
    if (key) refreshOne(key);
  });

  // The server says these keys changed since they were cached.
  EventBus.on(EVENTS.REFERENCE_DATA_CHANGED, ({ keys = [] } = {}) => {
    keys
      .filter(entryKey => entryKey.startsWith('dropdown:'))
      .forEach(entryKey => refreshOne(entryKey.slice('dropdown:'.length)));
  });

  return initialLoad;
}

/**
 * Resolves once every wizard <select> has its real options (instant on a
 * warm cache). Anything that writes values into those selects — e.g. loading
 * an existing case for editing — must await this first, or a value missing
 * from the placeholder markup would be treated as a free-text "أخرى".
 */
export function whenDropdownsReady() {
  return initialLoad || Promise.resolve();
}
