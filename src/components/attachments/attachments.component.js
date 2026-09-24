/* --------------------------------------------------------------------------
   CASE ATTACHMENTS COMPONENT (المرفقات والمستندات)
   Handles selecting a document type + file, listing every attached file
   with its classification, and removing attachments. Files live only in
   memory for the current session (as object URLs) — localStorage cannot
   hold raw file bytes, so nothing here is persisted across reloads.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc } from '../../core/state.js';
import { DOM } from '../../utils/dom.js';

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

export function initAttachmentsManager() {
  const docTypeSelect = DOM.qs('#case-doc-type');
  const fileInput = DOM.qs('#case-doc-upload');
  const listEl = DOM.qs('#attachments-list');
  const emptyState = DOM.qs('#attachments-empty-state');

  if (!fileInput || !listEl) return;

  const attachments = [];

  function updateEmptyState() {
    if (emptyState) {
      emptyState.style.display = attachments.length === 0 ? 'flex' : 'none';
    }
  }

  function renderAttachment(item) {
    const row = DOM.createElement('div', {
      className: 'case-page-att-item',
      dataset: { attId: item.id }
    });

    const info = DOM.createElement('span', {}, null);
    info.innerHTML = `📎 <strong>${DOM.escapeHTML(item.name)}</strong>` +
      (item.docType ? ` — ${DOM.escapeHTML(item.docType)}` : '') +
      (item.size ? ` <span style="color: var(--text-muted);">(${DOM.escapeHTML(formatFileSize(item.size))})</span>` : '');

    const actions = DOM.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });

    if (item.url) {
      const link = DOM.createElement('a', {
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'badge',
        style: { cursor: 'pointer', textDecoration: 'none' }
      }, 'عرض');
      actions.appendChild(link);
    }

    const delBtn = DOM.createElement('button', {
      type: 'button',
      className: 'btn-in-field-reset',
      title: 'حذف المرفق',
      style: { color: '#ef4444' }
    });
    delBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    delBtn.addEventListener('click', () => removeAttachment(item.id));
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);
    listEl.appendChild(row);
  }

  function removeAttachment(id) {
    const idx = attachments.findIndex(a => a.id === id);
    if (idx === -1) return;
    const [removed] = attachments.splice(idx, 1);
    if (removed.url) URL.revokeObjectURL(removed.url);

    const row = listEl.querySelector(`[data-att-id="${id}"]`);
    if (row) row.remove();

    updateEmptyState();
    triggerWorkflowRecalc();
    showToast(`تم حذف المرفق "${removed.name}"`);
  }

  fileInput.addEventListener('change', () => {
    if (!fileInput.files || fileInput.files.length === 0) return;

    const docType = docTypeSelect ? docTypeSelect.value : '';
    if (!docType) {
      showToast('يرجى اختيار تصنيف نوع المستند أولاً');
      if (docTypeSelect) docTypeSelect.focus();
      fileInput.value = '';
      return;
    }

    const file = fileInput.files[0];
    const item = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      docType,
      url: URL.createObjectURL(file)
    };

    attachments.push(item);
    renderAttachment(item);
    updateEmptyState();
    triggerWorkflowRecalc();
    showToast(`تم إرفاق الملف "${file.name}" بنجاح 📎`);

    // Allow re-selecting the same file name again and reset the classifier
    fileInput.value = '';
    if (docTypeSelect) docTypeSelect.selectedIndex = 0;
  });

  updateEmptyState();
}
