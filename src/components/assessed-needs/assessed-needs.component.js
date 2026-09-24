/* --------------------------------------------------------------------------
   ASSESSED NEEDS COMPONENT (STAGE 8)
   Handles assessed needs items, priority selection, cost estimates, and rendering.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc } from '../../core/state.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { parseLocalizedFloat } from '../../utils/nationalId.js';

export function initAssessedNeedsManager() {
  const btnOpenNeed = DOM.qs('#btn-open-add-need');
  const btnCancelNeed = DOM.qs('#btn-cancel-add-need');
  const btnSaveNeed = DOM.qs('#btn-save-need');
  const inlineNeedForm = DOM.qs('#add-need-inline-form');
  const needsList = DOM.qs('#needs-list-container');

  let needsItems = [];

  function renderNeedsList() {
    if (!needsList) return;
    const emptyState = DOM.qs('#needs-empty-state');

    if (needsItems.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      DOM.clear(needsList);
      if (emptyState) needsList.appendChild(emptyState);
      return;
    }

    DOM.clear(needsList);
    needsItems.forEach((item, idx) => {
      const card = DOM.createElement('div', {
        className: 'member-card',
        style: { marginBottom: '10px' }
      });
      card.innerHTML = `
        <div class="member-card__info">
          <div class="member-card__avatar" style="background: rgba(236, 72, 153, 0.15); color: #db2777;">🎯</div>
          <div>
            <h4 class="member-card__name">${DOM.escapeHTML(item.type)} • الأولوية: ${DOM.escapeHTML(item.priority)}</h4>
            <p class="member-card__meta">${item.description ? DOM.escapeHTML(item.description) + ' • ' : ''}التكلفة التقديرية: ${item.cost ? item.cost.toLocaleString() + ' جنيه' : 'غير محددة'}</p>
            ${item.reason ? `<p class="member-card__details" style="color: var(--color-primary);">السبب: ${DOM.escapeHTML(item.reason)}</p>` : ''}
          </div>
        </div>
        <button class="btn btn--ghost btn--sm btn-delete-need" data-idx="${idx}" title="حذف" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;
      needsList.appendChild(card);
    });

    needsList.querySelectorAll('.btn-delete-need').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        needsItems.splice(idx, 1);
        renderNeedsList();
        store.setAssessedNeeds(needsItems);
        triggerWorkflowRecalc();
      });
    });
  }

  if (btnOpenNeed && inlineNeedForm) {
    btnOpenNeed.addEventListener('click', () => inlineNeedForm.style.display = 'block');
  }
  if (btnCancelNeed && inlineNeedForm) {
    btnCancelNeed.addEventListener('click', () => inlineNeedForm.style.display = 'none');
  }

  if (btnSaveNeed) {
    btnSaveNeed.addEventListener('click', () => {
      const type = DOM.qs('#new-need-type')?.value || 'دعم مالي';
      const priority = DOM.qs('#new-need-priority')?.value || 'عالية';
      const description = DOM.qs('#new-need-description')?.value.trim() || '';
      const reason = DOM.qs('#new-need-reason')?.value.trim() || '';
      const cost = parseLocalizedFloat(DOM.qs('#new-need-cost')?.value) || 0;

      needsItems.push({ type, priority, description, reason, cost });
      if (inlineNeedForm) inlineNeedForm.style.display = 'none';
      renderNeedsList();
      store.setAssessedNeeds(needsItems);
      showToast('تمت إضافة الاحتياج بنجاح');
      triggerWorkflowRecalc();
    });
  }
}
