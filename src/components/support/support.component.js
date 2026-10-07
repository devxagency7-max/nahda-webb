/* --------------------------------------------------------------------------
   SUPPORT RECOMMENDATION COMPONENT (STAGE 7: الدعم)
   قايمة موحدة لأنواع الدعم متجمّعة تحت عناوين (أساسي/تعليمي/صحي/سكني/أخرى —
   عرض بس). كل نوع checkbox؛ الأنواع اللي دعمها لأفراد بتفتح تحتها قايمة
   (رب الأسرة + أفراد الأسرة) يتعلّم منها مين أخد الدعم — ده اللي بيتسجّل في
   support-recommendations (recipientType/familyMemberId) وبتعتمد عليه
   التقارير. أنواع الأسرة كلها (أساسي/سكني) مابتفتحش أفراد.
   «أخرى» بتفتح خانة يكتب فيها المستخدم اسم النوع بنفسه.
   -------------------------------------------------------------------------- */
import { triggerWorkflowRecalc } from '../../core/state.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { SUPPORT_GROUPS, canonicalSupportType, meatCategory } from '../../utils/support-catalog.js';

const MAX_TYPE_LENGTH = 100;
const HOUSEHOLD_BENEFICIARY = 'الأسرة';
const HEAD_ID = 'head';

let tileSeq = 0;
let membersSignature = null;

/* ---------------------------- أدوات صغيرة ---------------------------- */

function esc(text) {
  return DOM.escapeHTML(String(text ?? ''));
}

function headName() {
  return (DOM.qs('#case-name')?.value || '').trim();
}

/** رب الأسرة أول واحد، وبعده أفراد الأسرة اللي ليهم id (لازم id عشان الباك يربط الدعم بيهم). */
function recipientsList() {
  const list = [{ id: HEAD_ID, name: headName() || 'رب الأسرة', relation: 'رب الأسرة', isHead: true }];
  (store.familyMembers || []).forEach(m => {
    if (!m.memberId) return;
    list.push({
      id: m.memberId,
      name: m.name || 'فرد',
      relation: m.relation || '',
      isStudent: m.isStudent === 'true' || m.isStudent === true,
      stage: m.stage || '',
      grade: m.grade || '',
      university: m.university || ''
    });
  });
  return list;
}

function studentBadge(r) {
  if (!r.isStudent) return '';
  const detail = [r.stage, r.grade || r.university].filter(Boolean).join(' — ');
  return `<span class="support-member__student">🎓 طالب${detail ? ` — ${esc(detail)}` : ''}</span>`;
}

/* ---------------------------- بناء الشاشة ---------------------------- */

function buildTile({ name, label, scope, subs, custom, auto }) {
  tileSeq += 1;
  const id = `support-type-${tileSeq}`;
  const tile = document.createElement('div');
  tile.className = 'support-type-tile';
  tile.dataset.supportType = custom ? '' : name;
  tile.dataset.scope = scope;
  if (custom) tile.dataset.custom = 'true';
  if (auto) tile.dataset.auto = auto;
  const title = custom ? 'أخرى' : (label || name);
  tile.innerHTML = `
    <div class="form-group form-group--full support-type-tile__header">
      <input type="checkbox" class="support-type-checkbox" id="${id}" data-label="${esc(title)}" style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;">
      <label for="${id}" style="font-weight: 700; font-size: var(--font-size-sm); cursor: pointer;">${esc(title)}</label>
    </div>
    ${custom ? '<div class="support-type-tile__custom" style="display: none;"><input type="text" class="form-control support-type-tile__custom-name" maxlength="100" placeholder="اكتب نوع الدعم"></div>' : ''}
    ${auto === 'meat' ? '<div class="support-type-tile__auto" style="display: none;"></div>' : ''}
    ${subs?.length ? `<div class="support-type-tile__subs" style="display: none;">${subs.map(s => `<button type="button" class="chip-btn" data-value="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    ${scope === 'members' ? '<div class="support-type-tile__members" style="display: none;"></div>' : ''}`;
  bindTile(tile);
  return tile;
}

function buildGroup(group) {
  const section = document.createElement('div');
  section.className = 'support-group';
  section.dataset.group = group.key;
  section.innerHTML = `<h3 class="support-group__title">${esc(group.label)}</h3>`;
  const list = document.createElement('div');
  list.className = 'support-group__list';
  group.types.forEach(t => list.appendChild(buildTile(t)));
  if (group.key === 'other') list.appendChild(buildTile({ scope: 'members', custom: true }));
  section.appendChild(list);
  return section;
}

function syncTile(tile) {
  const checkbox = tile.querySelector('.support-type-checkbox');
  const checked = Boolean(checkbox?.checked);
  tile.classList.toggle('support-type-tile--active', checked);
  const subs = tile.querySelector('.support-type-tile__subs');
  const members = tile.querySelector('.support-type-tile__members');
  const customBox = tile.querySelector('.support-type-tile__custom');
  const auto = tile.querySelector('.support-type-tile__auto');
  if (auto) auto.style.display = checked ? 'block' : 'none';
  if (subs) subs.style.display = checked ? 'flex' : 'none';
  if (members) members.style.display = checked ? 'block' : 'none';
  if (customBox) customBox.style.display = checked ? 'block' : 'none';
  if (!checked) {
    DOM.qsa('.chip-btn--active', tile).forEach(c => c.classList.remove('chip-btn--active'));
    DOM.qsa('.support-member-checkbox', tile).forEach(c => { c.checked = false; });
  }
}

function bindTile(tile) {
  const checkbox = tile.querySelector('.support-type-checkbox');
  checkbox.addEventListener('change', () => {
    syncTile(tile);
    if (checkbox.checked) tile.querySelector('.support-type-tile__custom-name')?.focus();
    triggerWorkflowRecalc();
  });

  DOM.qsa('.support-type-tile__subs .chip-btn', tile).forEach(chip => {
    chip.addEventListener('click', () => {
      const wasActive = chip.classList.contains('chip-btn--active');
      DOM.qsa('.support-type-tile__subs .chip-btn', tile).forEach(c => c.classList.remove('chip-btn--active'));
      chip.classList.toggle('chip-btn--active', !wasActive);
      triggerWorkflowRecalc();
    });
  });

  const customName = tile.querySelector('.support-type-tile__custom-name');
  if (customName) {
    customName.addEventListener('input', () => {
      tile.dataset.supportType = customName.value.trim();
      checkbox.dataset.label = customName.value.trim() || 'أخرى';
    });
  }

  tile.querySelector('.support-type-tile__members')?.addEventListener('change', () => triggerWorkflowRecalc());
}

/* ---------------------------- قايمة الأفراد تحت كل نوع ---------------------------- */

function renderMembersInto(tile, recipients) {
  const box = tile.querySelector('.support-type-tile__members');
  if (!box) return;
  const checkedIds = new Set(
    DOM.qsa('.support-member-checkbox:checked', box).map(c => c.dataset.memberId)
  );
  const rows = recipients.map(r => `
    <label class="support-member">
      <input type="checkbox" class="support-member-checkbox" data-member-id="${esc(r.id)}"${checkedIds.has(r.id) ? ' checked' : ''}>
      <span class="support-member__name">${esc(r.name)}</span>
      ${r.relation ? `<span class="support-member__relation">${esc(r.relation)}</span>` : ''}
      ${studentBadge(r)}
    </label>`).join('');
  box.innerHTML = `
    <p class="support-type-tile__hint">اختر مين من الأسرة أخد/هياخد الدعم ده (اختياري — من غير اختيار بيتسجّل للأسرة كلها).</p>
    <div class="support-members-list">${rows}</div>`;
}

function familySize() {
  return 1 + (store.familyMembers || []).length;
}

/** السطر التوضيحي تحت اللحمة (الكمية بتتحسب لوحدها من عدد الأسرة). */
function refreshMeatAuto() {
  const size = familySize();
  DOM.qsa('.support-type-tile[data-auto="meat"] .support-type-tile__auto').forEach(el => {
    el.textContent = `الكمية تلقائي: ${meatCategory(size)} (عدد الأسرة ${size} — 3 أفراد فأكتر كيلو، أقل من كده نص كيلو)`;
  });
}

function renderAllMembers(force = false) {
  const recipients = recipientsList();
  const signature = JSON.stringify(recipients);
  if (!force && signature === membersSignature) return;
  membersSignature = signature;
  refreshMeatAuto();
  DOM.qsa('.support-type-tile[data-scope="members"]').forEach(tile => renderMembersInto(tile, recipients));
}

/* ---------------------------- نقطة الدخول ---------------------------- */

export function initSupportManager() {
  const host = DOM.qs('#support-types-list');
  if (!host) return;
  host.innerHTML = '';
  host.classList.add('support-groups');
  SUPPORT_GROUPS.forEach(g => host.appendChild(buildGroup(g)));
  renderAllMembers(true);

  EventBus.on(EVENTS.FAMILY_MEMBERS_UPDATED, () => renderAllMembers());
  EventBus.on(EVENTS.WORKFLOW_STEP_CHANGED, () => renderAllMembers());
}

/** يرجّع التاب لحالته الفاضية (بداية حالة جديدة). */
export function resetSupportManager() {
  DOM.qsa('.support-type-tile').forEach(tile => {
    const checkbox = tile.querySelector('.support-type-checkbox');
    if (checkbox) checkbox.checked = false;
    syncTile(tile);
    const customName = tile.querySelector('.support-type-tile__custom-name');
    if (customName) { customName.value = ''; tile.dataset.supportType = ''; }
  });
  // أي كارت «أخرى» إضافي اتعمل من حالة محمّلة يتشال؛ الأساسي بس يفضل.
  const customs = DOM.qsa('.support-type-tile[data-custom="true"]');
  customs.slice(1).forEach(t => t.remove());
  membersSignature = null;
  renderAllMembers(true);
}

/* ---------------------------- قراءة الاختيارات للحفظ ---------------------------- */

/** رسالة خطأ لو في «أخرى» متعلّم عليها من غير اسم، وإلا null. */
export function getSupportValidationError() {
  const empty = DOM.qsa('.support-type-tile[data-custom="true"]').find(tile =>
    tile.querySelector('.support-type-checkbox')?.checked &&
    !tile.querySelector('.support-type-tile__custom-name')?.value.trim());
  return empty ? 'اكتب اسم نوع الدعم في «أخرى» أو شيل العلامة منها 🙏' : null;
}

/**
 * عناصر PUT /support-recommendations — صف لكل (نوع × مستلم). نوع الأفراد من
 * غير ولا فرد معلَّم = صف واحد للأسرة كلها.
 */
export function collectSupportItems(notes = null) {
  const head = headName() || 'رب الأسرة';
  const byId = new Map((store.familyMembers || []).map(m => [m.memberId, m]));
  const items = [];

  DOM.qsa('.support-type-tile').forEach(tile => {
    if (!tile.querySelector('.support-type-checkbox')?.checked) return;
    const custom = tile.dataset.custom === 'true';
    const rawName = custom
      ? (tile.querySelector('.support-type-tile__custom-name')?.value || '')
      : (tile.dataset.supportType || '');
    const typeName = rawName.trim().slice(0, MAX_TYPE_LENGTH);
    if (!typeName) return;
    const category = tile.dataset.auto === 'meat'
      ? meatCategory(familySize())
      : (tile.querySelector('.support-type-tile__subs .chip-btn--active')?.dataset.value || null);

    const base = {
      supportType: typeName,
      supportCategory: category,
      proposedAmount: 0,
      reason: '',
      justification: '',
      priorityLevel: 'متوسط',
      notes: notes || null
    };

    const picked = tile.dataset.scope === 'members'
      ? DOM.qsa('.support-member-checkbox:checked', tile).map(c => c.dataset.memberId)
      : [];

    if (!picked.length) {
      items.push({ ...base, beneficiary: HOUSEHOLD_BENEFICIARY, recipientType: 'household', familyMemberId: null });
      return;
    }
    picked.forEach(id => {
      if (id === HEAD_ID) {
        items.push({ ...base, beneficiary: head, recipientType: 'head', familyMemberId: null });
      } else if (byId.has(id)) {
        items.push({ ...base, beneficiary: byId.get(id).name || 'فرد', recipientType: 'family_member', familyMemberId: id });
      }
    });
  });
  return items;
}

/* ---------------------------- تحميل اختيارات محفوظة ---------------------------- */

function tileFor(name, known) {
  if (known) return DOM.qsa('.support-type-tile').find(t => t.dataset.supportType === name);
  // نوع مش في القايمة الموحدة: بيتعرض تحت «أخرى» باسمه عشان مايتمسحش في الحفظ.
  const customs = DOM.qsa('.support-type-tile[data-custom="true"]');
  let tile = customs.find(t => !t.querySelector('.support-type-checkbox').checked);
  if (!tile) {
    tile = buildTile({ scope: 'members', custom: true });
    customs[customs.length - 1].after(tile);
    renderMembersInto(tile, recipientsList());
  }
  const input = tile.querySelector('.support-type-tile__custom-name');
  input.value = name;
  tile.dataset.supportType = name;
  return tile;
}

/**
 * يعلّم الاختيارات من recommendations راجعة من السيرفر. لازم يتنادى بعد
 * تحميل أفراد الأسرة في الـ store.
 */
export function loadSupportSelection(recommendations) {
  resetSupportManager();
  renderAllMembers(true);

  const grouped = new Map();
  (recommendations || []).forEach(r => {
    const { name, known, dropped } = canonicalSupportType(r.supportType);
    if (dropped) return;
    if (!grouped.has(name)) grouped.set(name, { known, rows: [] });
    grouped.get(name).rows.push(r);
  });

  grouped.forEach(({ known, rows }, name) => {
    const tile = tileFor(name, known);
    if (!tile) return;
    const checkbox = tile.querySelector('.support-type-checkbox');
    checkbox.checked = true;
    syncTile(tile);

    const category = rows.map(r => r.supportCategory).find(Boolean);
    if (category) {
      DOM.qsa('.support-type-tile__subs .chip-btn', tile)
        .find(c => c.dataset.value === category)?.classList.add('chip-btn--active');
    }

    rows.forEach(r => {
      const id = r.recipientType === 'head' ? HEAD_ID : (r.recipientType === 'family_member' ? r.familyMemberId : null);
      if (!id) return;
      const box = DOM.qsa('.support-member-checkbox', tile).find(c => c.dataset.memberId === id);
      if (box) box.checked = true;
    });
  });
  triggerWorkflowRecalc();
}
