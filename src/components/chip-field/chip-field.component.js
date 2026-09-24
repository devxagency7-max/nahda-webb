/* --------------------------------------------------------------------------
   MULTI-SELECT CHIP FIELD COMPONENT
   Generic "toggle chips + selection count badge + optional free-text أخرى"
   field, mirroring the mobile app's MultiSelectChipField widget so both
   surfaces present housing/utilities data identically.
   -------------------------------------------------------------------------- */
import { triggerWorkflowRecalc } from '../../core/state.js';
import { DOM } from '../../utils/dom.js';

const OTHER_OPTION = 'أخرى';

/**
 * Wires up every `.chip-field` container found within `scope`.
 * Expected markup per field:
 *   <div class="chip-field" data-field="housingType">
 *     <div class="chip-field__header">
 *       <span class="chip-field__label">طبيعة السكن</span>
 *       <span class="badge chip-field__count">0 اختيار</span>
 *     </div>
 *     <div class="chip-field__options">
 *       <button type="button" class="chip-btn" data-value="خاص">خاص</button>
 *       ...
 *       <button type="button" class="chip-btn" data-value="أخرى">أخرى</button>
 *     </div>
 *     <input type="text" class="form-input chip-field__other" style="display:none" placeholder="اكتب هنا...">
 *   </div>
 */
export function initChipFields(scope = document) {
  const fields = DOM.qsa('.chip-field', scope);

  fields.forEach(field => {
    const countEl = field.querySelector('.chip-field__count');
    const chips = DOM.qsa('.chip-btn', field);
    const otherInput = field.querySelector('.chip-field__other');

    function syncOtherVisibility() {
      const otherChip = chips.find(c => c.dataset.value === OTHER_OPTION);
      const otherActive = otherChip && otherChip.classList.contains('chip-btn--active');
      if (otherInput) {
        otherInput.style.display = otherActive ? 'block' : 'none';
        if (!otherActive) otherInput.value = '';
      }
    }

    function updateCount() {
      const count = chips.filter(c => c.classList.contains('chip-btn--active')).length;
      if (countEl) {
        countEl.textContent = `${count} اختيار`;
        countEl.classList.toggle('chip-field__count--active', count > 0);
      }
    }

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('chip-btn--active');
        syncOtherVisibility();
        updateCount();
        triggerWorkflowRecalc();
      });
    });

    if (otherInput) {
      otherInput.addEventListener('input', () => triggerWorkflowRecalc());
    }

    syncOtherVisibility();
    updateCount();
  });
}

/**
 * Reads the selected values (+ free-text "أخرى" detail) of every chip field
 * within `scope`, keyed by its `data-field` attribute.
 */
export function readChipFields(scope = document) {
  const result = {};
  DOM.qsa('.chip-field', scope).forEach(field => {
    const key = field.dataset.field;
    if (!key) return;
    const selected = DOM.qsa('.chip-btn.chip-btn--active', field).map(c => c.dataset.value);
    const otherInput = field.querySelector('.chip-field__other');
    result[key] = {
      selected,
      otherText: otherInput ? otherInput.value.trim() : ''
    };
  });
  return result;
}
