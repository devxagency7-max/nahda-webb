/* --------------------------------------------------------------------------
   CASE ATTACHMENTS LIST (المرفقات والمستندات)
   One row renderer for every attachment in the step-2 list — rows loaded from
   the server (case-edit.loader.js) and rows just uploaded (personal-data.api.js,
   the one and only change-listener on #case-doc-upload).

   - Open: GET /attachments/{id}/download mints a fresh 15-minute URL every
     time (never cached). Images open in an in-page preview; PDFs and anything
     else open in a new tab.
   - Delete: DELETE /attachments/{id}, after a confirmation — it's permanent.
   - Rows whose upload never finished (status ≠ complete) are marked
     «الرفع ماكملش», can't be opened, and aren't counted.
   - Infected files (scanStatus = infected) can't be opened.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc } from '../../core/state.js';
import { DOM } from '../../utils/dom.js';
import { confirmDialog } from '../../utils/dialog.js';
import { AttachmentsService } from '../../services/attachments.service.js';
import { messageFromError } from '../../services/errors.js';
import { documentTypeLabel } from '../../services/document-types.js';

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
}

/** A committed attachment. Rows from a commit response may carry no status. */
export function isAttachmentComplete(item) {
  return !item.status || item.status === 'complete';
}

function isInfected(item) {
  return item.scanStatus === 'infected';
}

function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

function syncEmptyState() {
  const listEl = DOM.qs('#attachments-list');
  const emptyState = DOM.qs('#attachments-empty-state');
  if (!listEl || !emptyState) return;
  emptyState.style.display = DOM.qsa('.case-page-att-item[data-att-row]', listEl).length === 0 ? 'flex' : 'none';
}

/** Number of committed attachments currently listed in step 2. */
export function attachmentRowCount() {
  return DOM.qsa('#attachments-list .case-page-att-item[data-att-id]').length;
}

async function removeAttachment(row, item) {
  const confirmed = await confirmDialog({
    title: 'حذف مرفق',
    message: `"${item.fileName || 'المرفق'}" هيتمسح من السيرفر نهائيًا ومش هتقدر ترجّعه. متأكد؟`,
    confirmLabel: 'حذف',
    danger: true
  });
  if (!confirmed || !row.isConnected) return;

  const delBtn = row.querySelector('.btn-delete-att');
  if (delBtn) delBtn.disabled = true;
  try {
    await AttachmentsService.remove(item.id);
    row.remove();
    syncEmptyState();
    triggerWorkflowRecalc();
    showToast(`تم حذف المرفق "${item.fileName || ''}"`, 'success');
  } catch (err) {
    if (delBtn) delBtn.disabled = false;
    showToast(`تعذّر حذف المرفق — ${messageFromError(err)}`, 'error');
  }
}

/* ------------------------------ Open / preview ------------------------------ */

function closeOnEscape(overlay) {
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  }
  document.addEventListener('keydown', onKey, true);
  return close;
}

/** In-page preview for an image. HEIC can't render in most browsers → a link instead. */
function showImagePreview(url, item) {
  const overlay = DOM.createElement('div', { className: 'modal-overlay' });
  const name = DOM.escapeHTML(item.fileName || 'صورة المرفق');
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${name}" style="max-width: 960px;">
      <div class="modal-card__header">
        <div class="modal-card__title" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
        <button type="button" class="modal-card__close" data-att-preview-close title="إغلاق" aria-label="إغلاق">✕</button>
      </div>
      <div class="modal-card__body" style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <img alt="${name}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px;">
        <p class="att-preview-fallback" style="display: none; color: var(--text-muted); text-align: center;">
          المتصفح مش قادر يعرض الصورة دي هنا (زي صور HEIC) — افتحها في تاب جديد أو نزّلها.
        </p>
      </div>
      <div class="modal-card__footer">
        <a class="btn btn--secondary" target="_blank" rel="noopener noreferrer">فتح في تاب جديد</a>
        <button type="button" class="btn btn--primary" data-att-preview-close>إغلاق</button>
      </div>
    </div>
  `;
  const img = overlay.querySelector('img');
  img.addEventListener('error', () => {
    img.style.display = 'none';
    overlay.querySelector('.att-preview-fallback').style.display = 'block';
  });
  img.src = url;
  overlay.querySelector('a').href = url;

  const close = closeOnEscape(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-att-preview-close]')) close();
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-att-preview-close]')?.focus();
}

/**
 * Opens an attachment: images in a preview, everything else in a new tab
 * (the browser shows PDFs and downloads the rest).
 * @param {{id:string, fileName?:string, mimeType?:string, status?:string, scanStatus?:string}} item
 */
export async function openAttachment(item) {
  if (!item?.id) return;
  if (!isAttachmentComplete(item)) {
    showToast('المرفق ده لسه ماكملش رفع على السيرفر، فمش هينفع يتفتح', 'warning');
    return;
  }
  if (isInfected(item)) {
    showToast('الملف ده فيه فيروس، ومينفعش يتفتح', 'error');
    return;
  }

  const asImage = isImageMime(item.mimeType);
  // Opened before the await: a tab opened after it gets blocked as a popup.
  const tab = asImage ? null : window.open('', '_blank');
  try {
    const res = await AttachmentsService.getDownloadUrl(item.id);
    const url = res?.downloadUrl;
    if (!url) throw new Error('empty downloadUrl');
    if (asImage || isImageMime(res.mimeType)) {
      if (tab) tab.close();
      showImagePreview(url, item);
    } else if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
  } catch (err) {
    if (tab) tab.close();
    showToast(`تعذّر فتح المرفق — ${messageFromError(err)}`, 'error');
  }
}

// One delegated handler for every «فتح» button — the step-2 rows and the
// case-details page cards (rendered as HTML strings) carry the same data-att-*.
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-att-open]');
  if (!btn) return;
  e.preventDefault();
  const d = btn.dataset;
  openAttachment({
    id: d.attOpen,
    fileName: d.attName,
    mimeType: d.attMime,
    status: d.attStatus,
    scanStatus: d.attScan
  });
});

/** data-att-* attributes for an «فتح» button (HTML-string renderers). */
export function attachmentOpenAttrs(item) {
  const attrs = {
    'data-att-open': item.id,
    'data-att-name': item.fileName || '',
    'data-att-mime': item.mimeType || '',
    'data-att-status': item.status || '',
    'data-att-scan': item.scanStatus || ''
  };
  return Object.entries(attrs).map(([k, v]) => `${k}="${DOM.escapeHTML(String(v))}"`).join(' ');
}

/** Status text for a row, or '' for a normal committed file. */
export function attachmentStatusLabel(item) {
  if (isInfected(item)) return '⚠️ فيه فيروس — مينفعش يتفتح';
  if (!isAttachmentComplete(item)) return 'الرفع ماكملش';
  return '';
}

/* --------------------------------- Rows --------------------------------- */

const OPEN_ICON = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;

const DELETE_ICON = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
`;

/**
 * @param {{id:string, fileName:string, documentType?:string, description?:string,
 *   fileSizeBytes?:number, size?:number, mimeType?:string, status?:string,
 *   scanStatus?:string, uploadedAtUtc?:string, uploadedByName?:string}} item
 */
function buildRow(item) {
  const complete = isAttachmentComplete(item);
  const dataset = { attRow: item.id };
  // Only committed rows count (empty state, per-tab progress, the 50 limit).
  if (complete) dataset.attId = item.id;
  const row = DOM.createElement('div', { className: 'case-page-att-item', dataset });

  const typeLabel = documentTypeLabel(item.documentType);
  const size = item.fileSizeBytes ?? item.size;
  const meta = [
    size || size === 0 ? formatFileSize(size) : '',
    item.uploadedAtUtc ? item.uploadedAtUtc.slice(0, 10) : '',
    item.uploadedByName ? `رفعه ${item.uploadedByName}` : ''
  ].filter(Boolean).join(' · ');
  const status = attachmentStatusLabel(item);

  const info = DOM.createElement('span', {}, null);
  info.innerHTML = `📎 <strong>${DOM.escapeHTML(item.fileName || '')}</strong>` +
    (typeLabel ? ` — ${DOM.escapeHTML(typeLabel)}` : '') +
    (item.description ? ` <span style="color: var(--text-muted);">(${DOM.escapeHTML(item.description)})</span>` : '') +
    (meta ? ` <span style="color: var(--text-muted);">· ${DOM.escapeHTML(meta)}</span>` : '') +
    (status ? ` <span class="badge" style="color: #b45309;">${DOM.escapeHTML(status)}</span>` : '');

  const actions = DOM.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });

  if (complete && !isInfected(item)) {
    const openBtn = DOM.createElement('button', {
      type: 'button',
      className: 'btn-in-field-reset btn-open-att',
      title: 'فتح المرفق',
      style: { color: 'var(--color-primary, #2563eb)' }
    });
    openBtn.innerHTML = OPEN_ICON;
    openBtn.addEventListener('click', () => openAttachment(item));
    actions.appendChild(openBtn);
  }

  const delBtn = DOM.createElement('button', {
    type: 'button',
    className: 'btn-in-field-reset btn-delete-att',
    title: 'حذف المرفق',
    style: { color: '#ef4444' }
  });
  delBtn.innerHTML = DELETE_ICON;
  delBtn.addEventListener('click', () => removeAttachment(row, item));
  actions.appendChild(delBtn);

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

/** Replaces the whole step-2 list with the server's attachments. */
export function renderAttachmentList(items) {
  const listEl = DOM.qs('#attachments-list');
  if (!listEl) return;
  DOM.qsa('.case-page-att-item[data-att-row]', listEl).forEach(row => row.remove());
  (items || []).forEach(item => listEl.appendChild(buildRow(item)));
  syncEmptyState();
  triggerWorkflowRecalc();
}

/** Appends one just-committed attachment (`id` = server attachmentId). */
export function addUploadedAttachmentRow(item) {
  const listEl = DOM.qs('#attachments-list');
  if (!listEl) return;
  listEl.appendChild(buildRow(item));
  syncEmptyState();
  triggerWorkflowRecalc();
}
