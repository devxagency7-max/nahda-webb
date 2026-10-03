/* --------------------------------------------------------------------------
   DIALOG UTILITIES — promise-based replacements for window.confirm/prompt
   Built on the shared `.modal-overlay` / `.modal-card` styles so destructive
   confirmations and text entry look like the rest of the app, can't be
   suppressed by the browser, and validate input before resolving.

     if (!(await confirmDialog({ message: '...' }))) return;
     const name = await promptDialog({ title: '...', maxLength: 100 });
     if (name === null) return;   // cancelled
   -------------------------------------------------------------------------- */
import { DOM } from './dom.js';

let dialogSeq = 0;

function openDialog({ title, subtitle, bodyHTML, confirmLabel, cancelLabel, secondaryLabel, danger, onConfirm, initialFocus }) {
  return new Promise((resolve) => {
    const id = `dlg-${++dialogSeq}`;
    const previouslyFocused = document.activeElement;

    const overlay = DOM.createElement('div', { className: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal-card modal-card--dialog" role="${danger ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="${id}-title">
        <div class="modal-card__header">
          <div>
            <div class="modal-card__title" id="${id}-title">${DOM.escapeHTML(title)}</div>
            ${subtitle ? `<div class="modal-card__subtitle">${DOM.escapeHTML(subtitle)}</div>` : ''}
          </div>
          <button type="button" class="modal-card__close" data-dlg-cancel title="إغلاق" aria-label="إغلاق">✕</button>
        </div>
        <div class="modal-card__body">${bodyHTML}</div>
        <div class="modal-card__footer">
          <button type="button" class="btn btn--secondary" data-dlg-cancel>${DOM.escapeHTML(cancelLabel)}</button>
          ${secondaryLabel ? `<button type="button" class="btn btn--danger" data-dlg-secondary>${DOM.escapeHTML(secondaryLabel)}</button>` : ''}
          <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-dlg-confirm>${DOM.escapeHTML(confirmLabel)}</button>
        </div>
      </div>
    `;

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch (_) { /* element may be gone */ }
      }
      resolve(value);
    };

    const tryConfirm = () => {
      const result = onConfirm(overlay);
      if (result !== undefined) finish(result.value);
    };

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(null);
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusables = overlay.querySelectorAll('button, input, textarea, select');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.querySelectorAll('[data-dlg-cancel]').forEach(b => b.addEventListener('click', () => finish(null)));
    overlay.querySelector('[data-dlg-confirm]').addEventListener('click', tryConfirm);
    overlay.querySelector('[data-dlg-secondary]')?.addEventListener('click', () => finish('secondary'));
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        tryConfirm();
      }
    });
    document.addEventListener('keydown', onKeyDown, true);

    document.body.appendChild(overlay);
    const focusTarget = initialFocus
      ? overlay.querySelector(initialFocus)
      : overlay.querySelector('[data-dlg-confirm]');
    if (focusTarget) {
      focusTarget.focus();
      if (focusTarget.select) focusTarget.select();
    }
  });
}

/**
 * Confirmation dialog. Resolves `true` on confirm, `false` on cancel / Esc /
 * backdrop click.
 * @param {{ title?: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title = 'تأكيد الإجراء',
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  danger = false
}) {
  return openDialog({
    title,
    bodyHTML: `<p class="dialog-message">${DOM.escapeHTML(message)}</p>`,
    confirmLabel,
    cancelLabel,
    danger,
    // Focus "cancel" by default on destructive actions so a stray Enter can't delete.
    initialFocus: danger ? '.modal-card__footer [data-dlg-cancel]' : null,
    onConfirm: () => ({ value: true })
  }).then(v => v === true);
}

/**
 * Three-way choice dialog. Resolves `'confirm'`, `'secondary'`, or `null` on
 * cancel / Esc / backdrop click. The secondary action is styled as the risky
 * one; focus starts on the (safe) confirm button.
 * @param {{ title?: string, message: string, confirmLabel: string, secondaryLabel: string, cancelLabel?: string }} opts
 * @returns {Promise<'confirm'|'secondary'|null>}
 */
export function choiceDialog({
  title = 'اختر الإجراء',
  message,
  confirmLabel,
  secondaryLabel,
  cancelLabel = 'إلغاء'
}) {
  return openDialog({
    title,
    bodyHTML: `<p class="dialog-message">${DOM.escapeHTML(message)}</p>`,
    confirmLabel,
    cancelLabel,
    secondaryLabel,
    danger: false,
    initialFocus: null,
    onConfirm: () => ({ value: 'confirm' })
  }).then(v => (v === 'confirm' || v === 'secondary' ? v : null));
}

/**
 * Text-entry dialog with validation. Resolves the trimmed string on confirm,
 * or `null` on cancel / Esc / backdrop click. Empty input (or input equal to
 * `initialValue` when `requireChange` is set) is rejected inline.
 * @param {{ title: string, label?: string, initialValue?: string, placeholder?: string,
 *           maxLength?: number, confirmLabel?: string, cancelLabel?: string, requireChange?: boolean }} opts
 * @returns {Promise<string|null>}
 */
export function promptDialog({
  title,
  label = '',
  initialValue = '',
  placeholder = '',
  maxLength = 100,
  confirmLabel = 'حفظ',
  cancelLabel = 'إلغاء',
  requireChange = false
}) {
  const id = `dlg-in-${dialogSeq + 1}`;
  return openDialog({
    title,
    bodyHTML: `
      ${label ? `<label class="dialog-label" for="${id}">${DOM.escapeHTML(label)}</label>` : ''}
      <input type="text" id="${id}" class="form-input" maxlength="${Number(maxLength)}"
             placeholder="${DOM.escapeHTML(placeholder)}" value="${DOM.escapeHTML(initialValue)}" autocomplete="off">
      <div class="dialog-error" role="alert" hidden></div>
    `,
    confirmLabel,
    cancelLabel,
    danger: false,
    initialFocus: 'input',
    onConfirm: (overlay) => {
      const input = overlay.querySelector('input');
      const errorEl = overlay.querySelector('.dialog-error');
      const value = input.value.trim();
      let error = '';
      if (!value) error = 'هذا الحقل مطلوب';
      else if (requireChange && value === initialValue.trim()) error = 'لم يتم تغيير القيمة';
      if (error) {
        errorEl.textContent = error;
        errorEl.hidden = false;
        input.focus();
        return undefined;
      }
      return { value };
    }
  });
}
