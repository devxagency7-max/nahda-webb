/* --------------------------------------------------------------------------
   SUPPORT RECOMMENDATION COMPONENT (STAGE 7: الدعم)
   Mirrors the mobile app's SupportTab: a multi-select checklist of support
   categories, each optionally revealing chip sub-options when checked.
   The approved-support card stays view-only and shows a waiting message
   until a reviewer decision exists (no such data source on the web yet).
   -------------------------------------------------------------------------- */
import { triggerWorkflowRecalc } from '../../core/state.js';
import { DOM } from '../../utils/dom.js';

export function initSupportManager() {
  const tiles = DOM.qsa('.support-type-tile');

  tiles.forEach(tile => {
    const checkbox = tile.querySelector('.support-type-checkbox');
    const subsContainer = tile.querySelector('.support-type-tile__subs');
    const subChips = subsContainer ? DOM.qsa('.chip-btn', subsContainer) : [];

    function syncTileState() {
      const checked = checkbox ? checkbox.checked : false;
      tile.classList.toggle('support-type-tile--active', checked);
      if (subsContainer) {
        subsContainer.style.display = checked ? 'flex' : 'none';
      }
      if (!checked) {
        subChips.forEach(chip => chip.classList.remove('chip-btn--active'));
      }
    }

    if (checkbox) {
      checkbox.addEventListener('change', () => {
        syncTileState();
        triggerWorkflowRecalc();
      });
    }

    subChips.forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('chip-btn--active');
        // اختيار أي فرعي يفعّل الفئة الرئيسية تلقائيًا (مطابق لسلوك onToggleSubOption في الأبلكيشن)
        if (chip.classList.contains('chip-btn--active') && checkbox && !checkbox.checked) {
          checkbox.checked = true;
          syncTileState();
        }
        triggerWorkflowRecalc();
      });
    });

    syncTileState();
  });
}
