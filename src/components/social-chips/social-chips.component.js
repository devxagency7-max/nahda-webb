/* --------------------------------------------------------------------------
   SOCIAL CLASSIFICATION CHIPS COMPONENT (STAGE 7)
   -------------------------------------------------------------------------- */
import { triggerWorkflowRecalc } from '../../core/state.js';
import { DOM } from '../../utils/dom.js';

export function initSocialClassificationChips() {
  const container = DOM.qs('#social-classifications-chips');
  if (!container) return;

  container.querySelectorAll('.chip-btn').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      chip.classList.toggle('chip-btn--active');
      triggerWorkflowRecalc();
    });
  });
}
