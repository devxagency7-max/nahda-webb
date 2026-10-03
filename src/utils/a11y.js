/* --------------------------------------------------------------------------
   ACCESSIBILITY HELPERS
   1) Global dialog manager: أي عنصر modal بيظهر (سواء اتبنى بالـ JS أو كان
      موجود في القالب وبيتفتح بـ style.display) بياخد تلقائيًا:
        - role="dialog" + aria-modal + اسم (aria-labelledby)
        - نقل الـ focus جواه، وحبس Tab/Shift+Tab جواه (focus trap)
        - inert لباقي الصفحة (الـ focus وقارئ الشاشة ميوصلوش للخلفية)
        - Escape يقفله، ورجوع الـ focus للعنصر اللي فتحه
      كده أي modal جديد مستقبلًا مش محتاج كود a11y خاص بيه.
   2) Accordion helper: aria-expanded / aria-controls متزامنين مع الحالة.
   -------------------------------------------------------------------------- */

const MODAL_SELECTOR = '.modal-overlay, .case-modal-overlay';
const DIALOG_INNER_SELECTOR = ':scope > .modal-card, :scope > .case-modal, :scope > .case-modal-content';
const TITLE_SELECTOR =
  '.modal-card__title, .case-modal__title, .case-modal-title, h1, h2, h3, [data-dialog-title]';
const CLOSE_SELECTOR =
  '[data-dialog-close], .modal-card__close, .case-modal-close, [id$="-close"], [id^="btn-close"], [id$="-cancel"], [id^="btn-cancel"]';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

// عناصر لازم تفضل شغالة ومسموعة حتى والـ modal مفتوح (toast/live regions).
const INERT_EXEMPT_SELECTOR = '[aria-live], [role="alert"], [role="status"], script, style, link';

let idCounter = 0;
let stack = []; // [{ overlay, dialog, opener }] — آخر عنصر هو الـ modal النشط
let inertedEls = new Set();
let scheduled = false;
let initialized = false;

const isVisible = (el) =>
  el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

const focusableIn = (root) => Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);

function ensureId(el, prefix) {
  if (!el.id) el.id = `${prefix}-${++idCounter}`;
  return el.id;
}

/** يضمن role/aria-modal/الاسم على الـ dialog ويرجّع العنصر اللي عليه الـ role. */
function prepareDialog(overlay) {
  const inner = overlay.querySelector(DIALOG_INNER_SELECTOR);
  const dialog = inner || overlay;

  // بعض القوالب حاطة role على الـ overlay نفسه؛ ننقله للكارت الداخلي.
  if (inner && overlay.getAttribute('role') === 'dialog') {
    const labelledBy = overlay.getAttribute('aria-labelledby');
    overlay.removeAttribute('role');
    overlay.removeAttribute('aria-labelledby');
    if (labelledBy && !inner.hasAttribute('aria-labelledby')) inner.setAttribute('aria-labelledby', labelledBy);
  }

  if (dialog.getAttribute('role') !== 'dialog' && dialog.getAttribute('role') !== 'alertdialog') {
    dialog.setAttribute('role', 'dialog');
  }
  dialog.setAttribute('aria-modal', 'true');

  if (!dialog.hasAttribute('aria-labelledby') && !dialog.hasAttribute('aria-label')) {
    const title = dialog.querySelector(TITLE_SELECTOR);
    if (title) dialog.setAttribute('aria-labelledby', ensureId(title, 'dialog-title'));
    else dialog.setAttribute('aria-label', 'نافذة حوار');
  }
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  // الـ overlay ممكن يكون اتحط عليه aria-hidden="true" وهو مقفول؛ مايفضلش كده وهو ظاهر.
  if (overlay.getAttribute('aria-hidden') === 'true') overlay.setAttribute('aria-hidden', 'false');
  return dialog;
}

function clearInert() {
  inertedEls.forEach((el) => el.removeAttribute('inert'));
  inertedEls = new Set();
}

/** inert لكل إخوة الـ modal على طول المسار لحد body (الـ modal نفسه وأجداده مستثنين). */
function applyInert(overlay) {
  clearInert();
  let node = overlay;
  while (node && node !== document.body && node.parentElement) {
    Array.from(node.parentElement.children).forEach((sibling) => {
      if (sibling === node || sibling.hasAttribute('inert')) return;
      if (sibling.matches(INERT_EXEMPT_SELECTOR) || sibling.querySelector('[aria-live], [role="alert"]')) return;
      sibling.setAttribute('inert', '');
      inertedEls.add(sibling);
    });
    node = node.parentElement;
  }
}

function moveFocusInside(dialog) {
  const preferred = dialog.querySelector('[autofocus], [data-dialog-initial-focus]');
  const target = preferred || focusableIn(dialog).find((el) => !el.matches(CLOSE_SELECTOR)) || dialog;
  target.focus({ preventScroll: true });
}

function sync() {
  scheduled = false;
  const visible = Array.from(document.querySelectorAll(MODAL_SELECTOR)).filter(isVisible);

  // modals اتقفلت أو اتشالت
  const closed = stack.filter((entry) => !visible.includes(entry.overlay));
  const wasActive = stack[stack.length - 1];
  stack = stack.filter((entry) => visible.includes(entry.overlay));

  // modals اتفتحت
  const opened = [];
  visible.forEach((overlay) => {
    if (stack.some((entry) => entry.overlay === overlay)) return;
    const active = document.activeElement;
    const dialog = prepareDialog(overlay);
    const entry = { overlay, dialog, opener: active instanceof HTMLElement && active !== document.body ? active : null };
    stack.push(entry);
    opened.push(entry);
  });

  const top = stack[stack.length - 1];
  if (top) {
    applyInert(top.overlay);
    if (opened.includes(top)) moveFocusInside(top.dialog);
    else if (!top.dialog.contains(document.activeElement)) moveFocusInside(top.dialog);
  } else {
    clearInert();
  }

  // رجّع الـ focus لمن فتح الـ modal اللي اتقفل (لو ده كان النشط وملقيناش modal تاني).
  if (closed.includes(wasActive)) {
    const restoreTo = wasActive.opener;
    if (!top && restoreTo && restoreTo.isConnected && isVisible(restoreTo)) {
      restoreTo.focus({ preventScroll: true });
    }
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(sync);
}

function onKeydown(e) {
  const top = stack[stack.length - 1];
  if (!top) return;

  if (e.key === 'Escape' && !e.defaultPrevented) {
    const closeBtn = top.dialog.querySelector(CLOSE_SELECTOR);
    if (closeBtn) {
      e.preventDefault();
      closeBtn.click();
    }
    return;
  }

  if (e.key !== 'Tab') return;
  const items = focusableIn(top.dialog);
  if (items.length === 0) {
    e.preventDefault();
    top.dialog.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!top.dialog.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === top.dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** لو الـ focus برّه الـ modal النشط بأي وسيلة (click على عنصر، إلخ) يرجع جوه. */
function onFocusIn(e) {
  const top = stack[stack.length - 1];
  if (!top || top.dialog.contains(e.target)) return;
  if (e.target instanceof Element && e.target.closest(INERT_EXEMPT_SELECTOR)) return;
  moveFocusInside(top.dialog);
}

export function initDialogA11y() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', onFocusIn);
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden']
  });
  schedule();
}

// أزرار toggle بتتحكم في حالتها بإضافة/إزالة class؛ بنزامن aria-pressed معاها
// مركزيًا بدل ما كل مكوّن يفتكر يعملها (chips، فلاتر الحالات، pills الأدوار).
const TOGGLE_BUTTONS = [
  ['.chip-btn', 'chip-btn--active'],
  ['.btn-case-filter', 'btn-case-filter--active'],
  ['.employee-role-pill', 'employee-role-pill--active']
];

function syncPressed(el) {
  if (!(el instanceof HTMLElement)) return;
  for (const [selector, activeClass] of TOGGLE_BUTTONS) {
    if (el.matches(selector)) {
      const pressed = el.classList.contains(activeClass) ? 'true' : 'false';
      if (el.getAttribute('aria-pressed') !== pressed) el.setAttribute('aria-pressed', pressed);
      return;
    }
  }
}

function syncPressedTree(root) {
  if (!(root instanceof HTMLElement)) return;
  syncPressed(root);
  TOGGLE_BUTTONS.forEach(([selector]) => root.querySelectorAll(selector).forEach(syncPressed));
}

export function initToggleStateA11y() {
  syncPressedTree(document.body);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') syncPressed(record.target);
      else record.addedNodes.forEach(syncPressedTree);
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

/**
 * أزرار فتح نماذج/لوحات inline بتتحكم في الظهور بـ style.display: الزرار
 * المعلَّم `data-disclosure` + `aria-controls` بياخد aria-expanded تلقائيًا
 * من ظهور العنصر المستهدف فعليًا، من غير ما كل مكوّن يفتكر يحدّثه.
 */
export function initDisclosureA11y() {
  let pending = false;
  const sync = () => {
    pending = false;
    document.querySelectorAll('[data-disclosure][aria-controls]').forEach((btn) => {
      const target = document.getElementById(btn.getAttribute('aria-controls'));
      const expanded = Boolean(target) && target.getClientRects().length > 0;
      const value = expanded ? 'true' : 'false';
      if (btn.getAttribute('aria-expanded') !== value) btn.setAttribute('aria-expanded', value);
    });
  };
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(sync);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  sync();
}

/**
 * يربط زرار بمحتوى قابل للطي: aria-expanded + aria-controls.
 * @param {HTMLElement} button
 * @param {HTMLElement|null} panel
 * @param {boolean} expanded
 */
export function setExpanded(button, panel, expanded) {
  if (!button) return;
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (panel) {
    button.setAttribute('aria-controls', ensureId(panel, 'panel'));
  }
}
