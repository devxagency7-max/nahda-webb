/* --------------------------------------------------------------------------
   CASE ATTACHMENTS LIST (المرفقات والمستندات)
   Renders a row in the step-2 list for an attachment that has ALREADY been
   uploaded and committed on the server. The upload itself is driven by the one
   and only change-listener on #case-doc-upload (wireAttachmentUpload in
   personal-data.api.js) — a second listener here used to clear the input
   before that one could read the file, and drew "attached" rows for files
   that never reached the server.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc } from '../../core/state.js';
import { DOM } from '../../utils/dom.js';
import { AttachmentsService } from '../../services/attachments.service.js';
import { messageFromError } from '../../services/errors.js';
import { documentTypeLabel } from '../../services/document-types.js';

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

function syncEmptyState() {
  const listEl = DOM.qs('#attachments-list');
  const emptyState = DOM.qs('#attachments-empty-state');
  if (!listEl || !emptyState) return;
  emptyState.style.display = DOM.qsa('.case-page-att-item[data-att-id]', listEl).length === 0 ? 'flex' : 'none';
}

async function removeAttachment(row, item) {
  const delBtn = row.querySelector('.btn-delete-uploaded-att');
  if (delBtn) delBtn.disabled = true;
  try {
    await AttachmentsService.remove(item.id);
    row.remove();
    syncEmptyState();
    triggerWorkflowRecalc();
    showToast(`تم حذف المرفق "${item.fileName}"`, 'success');
  } catch (err) {
    if (delBtn) delBtn.disabled = false;
    showToast(`تعذّر حذف المرفق — ${messageFromError(err)}`, 'error');
  }
}

/**
 * @param {{id:string, fileName:string, documentType?:string, size?:number}} item
 *   `id` is the server attachmentId (from the commit response).
 */
export function addUploadedAttachmentRow(item) {
  const listEl = DOM.qs('#attachments-list');
  if (!listEl) return;

  const row = DOM.createElement('div', {
    className: 'case-page-att-item',
    dataset: { attId: item.id }
  });

  const typeLabel = documentTypeLabel(item.documentType);
  const info = DOM.createElement('span', {}, null);
  info.innerHTML = `📎 <strong>${DOM.escapeHTML(item.fileName)}</strong>` +
    (typeLabel ? ` — ${DOM.escapeHTML(typeLabel)}` : '') +
    (item.size ? ` <span style="color: var(--text-muted);">(${DOM.escapeHTML(formatFileSize(item.size))})</span>` : '');

  const actions = DOM.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });

  const delBtn = DOM.createElement('button', {
    type: 'button',
    className: 'btn-in-field-reset btn-delete-uploaded-att',
    title: 'حذف المرفق',
    style: { color: '#ef4444' }
  });
  delBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  `;
  delBtn.addEventListener('click', () => removeAttachment(row, item));
  actions.appendChild(delBtn);

  row.appendChild(info);
  row.appendChild(actions);
  listEl.appendChild(row);

  syncEmptyState();
  triggerWorkflowRecalc();
}
