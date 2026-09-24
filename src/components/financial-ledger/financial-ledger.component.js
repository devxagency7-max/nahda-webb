/* --------------------------------------------------------------------------
   FINANCIAL LEDGER COMPONENT (STAGE 6)
   Handles income and expense sources, total calculation, net budget status,
   and DOM list updates.
   -------------------------------------------------------------------------- */
import { showToast } from '../../utils/toast.js';
import { triggerWorkflowRecalc, onWorkflowRecalc } from '../../core/state.js';
import { store } from '../../state/store.js';
import { DOM } from '../../utils/dom.js';
import { parseLocalizedFloat } from '../../utils/nationalId.js';
import { readAgricultureData } from '../agriculture/agriculture.component.js';

// 7 تصنيفات مصروف ثابتة تُزرع افتراضيًا في كل حالة (قيمتها تبدأ فاضية والمستخدم
// بيملاها)، + بند "إيجار أراضي زراعية" الثامن المرتبط بخطوة الحيازة الزراعية —
// كلهم غير قابلين للحذف، مطابق تمامًا لـ FinancialFormData._defaultExpenseItems()
// في الأبلكيشن.
const _defaultExpenseCategories = [
  'الأكل والشرب',
  'المصروفات الدراسية',
  'الكهرباء',
  'المياه',
  'الغاز',
  'الإيجار',
  'القسط',
];

// تطبيع أي مبلغ لقيمته الشهرية حسب الدورية — مطابق تمامًا لـ monthlyAmount
// في IncomeItemFormData/ExpenseItemFormData بالأبلكيشن.
function toMonthlyAmount(amount, frequency) {
  if (!amount) return 0;
  switch (frequency) {
    case 'يومي': return amount * 30;
    case 'أسبوعي': return amount * 4;
    case 'سنوي': return amount / 12;
    default: return amount; // شهري / موسمي كقيمة مباشرة
  }
}

export function initFinancialManager() {
  const btnOpenIncome = DOM.qs('#btn-open-add-income');
  const btnCancelIncome = DOM.qs('#btn-cancel-add-income');
  const btnSaveIncome = DOM.qs('#btn-save-income');
  const inlineIncomeForm = DOM.qs('#add-income-inline-form');
  const incomeList = DOM.qs('#income-list-container');

  const btnOpenExpense = DOM.qs('#btn-open-add-expense');
  const btnCancelExpense = DOM.qs('#btn-cancel-add-expense');
  const btnSaveExpense = DOM.qs('#btn-save-expense');
  const inlineExpenseForm = DOM.qs('#add-expense-inline-form');
  const expenseList = DOM.qs('#expense-list-container');

  const statIncome = DOM.qs('#stat-total-income');
  const statExpenses = DOM.qs('#stat-total-expenses');
  const statNet = DOM.qs('#stat-net-income');

  // إظهار/إخفاء حقل مبلغ تكافل وكرامة لرب الأسرة حسب حالة الـ checkbox —
  // نفس نمط "new-member-is-student" في نموذج الفرد التابع.
  const headTakafulCheckbox = DOM.qs('#head-takaful-karama');
  const headTakafulAmountGroup = DOM.qs('#head-takaful-amount-group');
  const headTakafulAmountInput = DOM.qs('#head-takaful-amount');
  if (headTakafulCheckbox && headTakafulAmountGroup) {
    headTakafulCheckbox.addEventListener('change', () => {
      headTakafulAmountGroup.style.display = headTakafulCheckbox.checked ? 'block' : 'none';
      if (!headTakafulCheckbox.checked && headTakafulAmountInput) {
        headTakafulAmountInput.value = '';
      }
      triggerWorkflowRecalc();
    });
  }
  if (headTakafulAmountInput) {
    headTakafulAmountInput.addEventListener('input', () => triggerWorkflowRecalc());
  }

  let incomeItems = [];
  const expandedTakaful = { value: false };
  // 7 بنود مصروف ثابتة مزروعة افتراضيًا (locked, amount = 0)، + بند "إيجار
  // أراضي زراعية" الثامن هيتضاف/يتزامن لاحقًا عن طريق syncLandRentExpenseItem.
  let expenseItems = _defaultExpenseCategories.map(type => ({
    type,
    amount: 0,
    frequency: 'شهري',
    locked: true
  }));

  // بند مصروف "إيجار أراضي زراعية" — مرتبط بحقل سعر إيجار الأرض في خطوة 5
  // (لو نوع الحيازة "إيجار")، مطابق لـ _syncAgriculturalHolding في الأبلكيشن.
  const LAND_RENT_EXPENSE_TYPE = 'إيجار أراضي زراعية';
  let isSyncing = false;

  function syncLandRentExpenseItem() {
    if (isSyncing) return;
    isSyncing = true;
    try {
      // بنقرأ عبر readAgricultureData بدل ما نلمس عناصر بعينها — سؤال الحيازة
      // بقى راديو (نعم/لا) مش شيك بوكس، والقارئ ده هو مصدر الحقيقة الوحيد.
      const agri = readAgricultureData();
      const agriHasLand = agri.hasLand === 'yes';
      const agriLandType = agri.landType;
      const agriRentAmount = parseLocalizedFloat(agri.rentAmount) || 0;
      // البند يفضل موجود دايمًا (زي الأبلكيشن) لكن بقيمة صفر لو الحيازة مش إيجار.
      const amount = (agriHasLand && agriLandType === 'إيجار') ? agriRentAmount : 0;

      const existingIdx = expenseItems.findIndex(item => item.type === LAND_RENT_EXPENSE_TYPE);
      if (existingIdx === -1) {
        expenseItems.push({
          type: LAND_RENT_EXPENSE_TYPE,
          amount,
          frequency: 'شهري',
          locked: true,
          auto: true,
          sourceId: 'agri-rent-amount'
        });
      } else {
        expenseItems[existingIdx] = { ...expenseItems[existingIdx], amount };
      }

      renderExpenseList();
      recalculateBudget(false);
    } finally {
      isSyncing = false;
    }
  }

  // بنود الدخل التلقائية الأربعة الثابتة (🔒 مرتبطة بحقول من خطوات أخرى —
  // موجودة دايمًا حتى بقيمة صفر، مطابقة لـ _defaultIncomeItems في
  // financial_form.dart): دخل رب الأسرة، معاش، تكافل وكرامة، دخل أراضي زراعية.
  // بند "تكافل وكرامة" مُجمَّع من كل المستفيدين (رب الأسرة + الأفراد
  // التابعين) في contributors واحدة تحت بند واحد، مطابق لمفهوم
  // TakafulKaramaContributor بالأبلكيشن.
  function buildAutoIncomeItems() {
    const headMonthlyIncome = parseLocalizedFloat(DOM.qs('#head-monthly-income')?.value) || 0;
    const headIncomeItem = {
      type: 'الدخل الشهري',
      person: 'رب الأسرة',
      amount: headMonthlyIncome,
      frequency: 'شهري',
      auto: true,
      sourceId: 'head-monthly-income'
    };

    const pensionItem = {
      type: 'معاش',
      person: 'رب الأسرة',
      amount: 0,
      frequency: 'شهري',
      auto: true,
      locked: true
    };

    // بند "تكافل وكرامة" مُجمَّع من كل المستفيدين (رب الأسرة + الأفراد
    // التابعين) في contributors واحدة تحت بند واحد، مطابق لمفهوم
    // TakafulKaramaContributor بالأبلكيشن — مش بند منفصل لكل شخص.
    const contributors = [];
    const headTakafulChecked = DOM.qs('#head-takaful-karama')?.checked;
    const headTakafulAmount = parseLocalizedFloat(DOM.qs('#head-takaful-amount')?.value) || 0;
    if (headTakafulChecked && headTakafulAmount > 0) {
      contributors.push({
        relation: 'رب الأسرة',
        amount: headTakafulAmount,
        sourceId: 'head-takaful-amount'
      });
    }

    const memberIncomeItems = [];
    (store.familyMembers || []).forEach((member, idx) => {
      const name = member.name || `فرد ${idx + 1}`;

      if (member.takafulKarama === 'true') {
        const amount = parseLocalizedFloat(member.takafulKaramaAmount) || 0;
        if (amount > 0) {
          contributors.push({
            relation: name,
            amount,
            sourceId: `member-${idx}-takaful`
          });
        }
      }

      const memberIncome = parseLocalizedFloat(member.income) || 0;
      if (memberIncome > 0) {
        memberIncomeItems.push({
          type: 'الدخل الشهري',
          person: name,
          amount: memberIncome,
          frequency: 'شهري',
          auto: true,
          sourceId: `member-${idx}-income`
        });
      }
    });

    const takafulItem = {
      type: 'معاش تكافل وكرامة',
      person: 'رب الأسرة',
      amount: contributors.reduce((sum, c) => sum + c.amount, 0),
      frequency: 'شهري',
      auto: true,
      locked: true,
      contributors
    };

    // دخل الأرض الزراعية (لو تمليك) — يُقسم على 12 شهريًا، مطابق لتعليق
    // annualLandIncome في agricultural_holding_tab.dart.
    const agri = readAgricultureData();
    const agriHasLand = agri.hasLand === 'yes';
    const agriLandType = agri.landType;
    const agriAnnualIncome = parseLocalizedFloat(agri.annualIncome) || 0;
    const landIncomeItem = {
      type: 'دخل الأرض الزراعية (شهري)',
      person: 'رب الأسرة',
      amount: (agriHasLand && agriLandType === 'تمليك') ? agriAnnualIncome / 12 : 0,
      frequency: 'شهري',
      auto: true,
      locked: true,
      sourceId: 'agri-annual-income',
      sourceIsAnnual: true
    };

    return [headIncomeItem, pensionItem, takafulItem, landIncomeItem, ...memberIncomeItems];
  }

  // كتابة قيمة معدَّلة من بند تلقائي هنا رجوعًا لحقلها الأصلي في خطوة 1 أو 5 —
  // مزامنة ثنائية الاتجاه مطابقة لـ onExternalAmountChanged في financial_tab.dart.
  function writeAmountToSource(sourceId, amount, sourceIsAnnual) {
    const memberMatch = /^member-(\d+)-(income|takaful)$/.exec(sourceId);
    if (memberMatch) {
      const idx = parseInt(memberMatch[1], 10);
      const kind = memberMatch[2];
      const members = [...(store.familyMembers || [])];
      if (!members[idx]) return;
      members[idx] = { ...members[idx] };
      if (kind === 'income') {
        members[idx].income = String(amount);
      } else {
        members[idx].takafulKaramaAmount = String(amount);
      }
      store.setFamilyMembers(members);

      // لو نفس الفرد مفتوح حاليًا في نموذج التعديل، نعكس القيمة في الحقل مباشرة.
      const incomeInput = DOM.qs('#new-member-income');
      const takafulInput = DOM.qs('#new-member-takaful-amount');
      if (kind === 'income' && incomeInput) incomeInput.value = amount;
      if (kind === 'takaful' && takafulInput) takafulInput.value = amount;
      return;
    }

    const field = DOM.qs(`#${sourceId}`);
    if (!field) return;
    field.value = sourceIsAnnual ? amount * 12 : amount;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncAutoIncomeItems() {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const manualItems = incomeItems.filter(item => !item.auto);
      incomeItems = [...buildAutoIncomeItems(), ...manualItems];
      renderIncomeList();
      recalculateBudget(false);
    } finally {
      isSyncing = false;
    }
  }

  // notifyRecalc = false عند الاستدعاء من مزامنة البنود التلقائية نفسها
  // (syncAutoIncomeItems)، لتفادي حلقة لا نهائية: recalc → sync → recalc...
  function recalculateBudget(notifyRecalc = true) {
    const totalInc = incomeItems.reduce((acc, curr) => acc + toMonthlyAmount(curr.amount, curr.frequency), 0);
    const totalExp = expenseItems.reduce((acc, curr) => acc + toMonthlyAmount(curr.amount, curr.frequency), 0);
    const net = totalInc - totalExp;

    if (statIncome) statIncome.textContent = `${totalInc.toLocaleString()} جنيه`;
    if (statExpenses) statExpenses.textContent = `${totalExp.toLocaleString()} جنيه`;
    if (statNet) {
      statNet.textContent = `${net.toLocaleString()} جنيه`;
      statNet.style.color = net >= 0 ? '#2563eb' : '#dc2626';
    }

    store.setFinancialItems(incomeItems, expenseItems);
    if (notifyRecalc && !isSyncing) triggerWorkflowRecalc();
  }

  function renderIncomeList() {
    if (!incomeList) return;
    const emptyState = DOM.qs('#income-empty-state');

    if (incomeItems.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      DOM.clear(incomeList);
      if (emptyState) incomeList.appendChild(emptyState);
      return;
    }

    DOM.clear(incomeList);
    incomeItems.forEach((item, idx) => {
      const hasContributors = Array.isArray(item.contributors) && item.contributors.length > 0;
      const card = DOM.createElement('div', {
        className: 'member-card',
        style: { marginBottom: '10px', flexDirection: 'column', alignItems: 'stretch' }
      });
      const lockedAmountInput = item.auto && !hasContributors
        ? `<input type="number" class="form-input income-auto-amount-input" data-idx="${idx}"
             value="${item.amount}" style="width: 110px; height: 34px; padding: 4px 8px; font-size: 12.5px; font-weight: 700;">`
        : '';
      const trailingControl = item.auto
        ? lockedAmountInput
        : `<button class="btn btn--ghost btn--sm btn-delete-income" data-idx="${idx}" title="حذف" type="button">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
           </button>`;
      // بند فيه Contributors (تكافل وكرامة) مبلغه الإجمالي محسوب من مجموع
      // المساهمين، مش قابل للتعديل المباشر — التعديل يبقى من تفاصيل كل مساهم.
      const amountControl = hasContributors
        ? `<span>${item.amount.toLocaleString()} جنيه/شهرياً</span>`
        : item.auto
          ? ''
          : `<span>${item.amount.toLocaleString()} جنيه${item.frequency && item.frequency !== 'شهري' ? ` / ${DOM.escapeHTML(item.frequency)}` : '/شهرياً'}</span>`;
      const personLabel = item.person && item.person !== 'رب الأسرة'
        ? DOM.escapeHTML(item.person)
        : '';
      const metaLine = [personLabel, amountControl].filter(Boolean).join(' • ');
      const expandControl = hasContributors
        ? `<button class="btn btn--ghost btn--sm btn-toggle-contributors" data-idx="${idx}" title="تفاصيل المساهمين" type="button">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               ${expandedTakaful.value ? '<polyline points="18 15 12 9 6 15"></polyline>' : '<polyline points="6 9 12 15 18 9"></polyline>'}
             </svg>
           </button>`
        : '';

      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div class="member-card__info">
            <div class="member-card__avatar" style="background: rgba(16, 185, 129, 0.15); color: #059669;">💰</div>
            <div>
              <h4 class="member-card__name">${DOM.escapeHTML(item.type)}</h4>
              ${metaLine ? `<p class="member-card__meta" style="display: flex; align-items: center; gap: 6px;">${metaLine}</p>` : ''}
              ${item.notes ? `<p class="member-card__meta" style="color: var(--text-muted); font-size: 11.5px;">📝 ${DOM.escapeHTML(item.notes)}</p>` : ''}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            ${expandControl}
            ${trailingControl}
          </div>
        </div>
        ${hasContributors && expandedTakaful.value ? `
          <div style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.5); border-radius: 10px; border: 1px solid var(--border-color);">
            ${item.contributors.map((c, cIdx) => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 0;">
                <span style="font-size: 12.5px; font-weight: 700; color: var(--text-secondary);">${DOM.escapeHTML(c.relation)}</span>
                <input type="number" class="form-input contributor-amount-input" data-idx="${idx}" data-contributor-idx="${cIdx}"
                  value="${c.amount}" style="width: 100px; height: 32px; padding: 4px 8px; font-size: 12px; font-weight: 800;">
              </div>
            `).join('')}
          </div>
        ` : ''}
      `;
      incomeList.appendChild(card);
    });

    incomeList.querySelectorAll('.btn-delete-income').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        incomeItems.splice(idx, 1);
        renderIncomeList();
        recalculateBudget();
      });
    });

    incomeList.querySelectorAll('.btn-toggle-contributors').forEach(btn => {
      btn.addEventListener('click', () => {
        expandedTakaful.value = !expandedTakaful.value;
        renderIncomeList();
      });
    });

    incomeList.querySelectorAll('.income-auto-amount-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx, 10);
        const item = incomeItems[idx];
        if (!item) return;
        const amount = parseLocalizedFloat(input.value) || 0;
        item.amount = amount;
        writeAmountToSource(item.sourceId, amount, item.sourceIsAnnual);
        recalculateBudget();
      });
    });

    incomeList.querySelectorAll('.contributor-amount-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx, 10);
        const cIdx = parseInt(input.dataset.contributorIdx, 10);
        const item = incomeItems[idx];
        const contributor = item?.contributors?.[cIdx];
        if (!contributor) return;
        const amount = parseLocalizedFloat(input.value) || 0;
        contributor.amount = amount;
        item.amount = item.contributors.reduce((sum, c) => sum + c.amount, 0);
        writeAmountToSource(contributor.sourceId, amount);
        recalculateBudget();
      });
    });
  }

  function renderExpenseList() {
    if (!expenseList) return;
    const emptyState = DOM.qs('#expense-empty-state');

    if (expenseItems.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      DOM.clear(expenseList);
      if (emptyState) expenseList.appendChild(emptyState);
      return;
    }

    DOM.clear(expenseList);
    expenseItems.forEach((item, idx) => {
      const card = DOM.createElement('div', {
        className: 'member-card',
        style: { marginBottom: '10px' }
      });
      const trailingControl = item.locked
        ? `<input type="number" class="form-input expense-locked-amount-input" data-idx="${idx}"
             value="${item.amount}" style="width: 110px; height: 34px; padding: 4px 8px; font-size: 12.5px; font-weight: 700;">`
        : `<button class="btn btn--ghost btn--sm btn-delete-expense" data-idx="${idx}" title="حذف" type="button">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
           </button>`;
      const amountControl = item.locked
        ? ''
        : `<span>${item.amount.toLocaleString()} جنيه${item.frequency && item.frequency !== 'شهري' ? ` / ${DOM.escapeHTML(item.frequency)}` : '/شهرياً'}</span>`;
      card.innerHTML = `
        <div class="member-card__info">
          <div class="member-card__avatar" style="background: rgba(239, 68, 68, 0.15); color: #dc2626;">💸</div>
          <div>
            <h4 class="member-card__name">${DOM.escapeHTML(item.type)}</h4>
            ${amountControl ? `<p class="member-card__meta" style="display: flex; align-items: center; gap: 6px;">${amountControl}</p>` : ''}
            ${item.notes ? `<p class="member-card__meta" style="color: var(--text-muted); font-size: 11.5px;">📝 ${DOM.escapeHTML(item.notes)}</p>` : ''}
          </div>
        </div>
        ${trailingControl}
      `;
      expenseList.appendChild(card);
    });

    expenseList.querySelectorAll('.btn-delete-expense').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        expenseItems.splice(idx, 1);
        renderExpenseList();
        recalculateBudget();
      });
    });

    expenseList.querySelectorAll('.expense-locked-amount-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx, 10);
        const item = expenseItems[idx];
        if (!item) return;
        const amount = parseLocalizedFloat(input.value) || 0;
        item.amount = amount;
        if (item.sourceId) writeAmountToSource(item.sourceId, amount, item.sourceIsAnnual);
        recalculateBudget();
      });
    });
  }

  if (btnOpenIncome && inlineIncomeForm) {
    btnOpenIncome.addEventListener('click', () => inlineIncomeForm.style.display = 'block');
  }
  if (btnCancelIncome && inlineIncomeForm) {
    btnCancelIncome.addEventListener('click', () => inlineIncomeForm.style.display = 'none');
  }

  if (btnSaveIncome) {
    btnSaveIncome.addEventListener('click', () => {
      const type = DOM.qs('#new-income-type')?.value || 'دخل آخر';
      const person = DOM.qs('#new-income-person')?.value.trim() || 'رب الأسرة';
      const amount = parseLocalizedFloat(DOM.qs('#new-income-amount')?.value) || 0;
      const frequency = DOM.qs('#new-income-frequency')?.value || 'شهري';
      const notes = DOM.qs('#new-income-notes')?.value.trim() || '';

      if (amount <= 0) {
        showToast('يرجى إدخال مبلغ الدخل بشكل صحيح');
        return;
      }

      incomeItems.push({ type, person, amount, frequency, notes });
      if (inlineIncomeForm) inlineIncomeForm.style.display = 'none';
      const notesInput = DOM.qs('#new-income-notes');
      if (notesInput) notesInput.value = '';
      renderIncomeList();
      recalculateBudget();
      showToast('تمت إضافة مصدر الدخل بنجاح');
    });
  }

  if (btnOpenExpense && inlineExpenseForm) {
    btnOpenExpense.addEventListener('click', () => inlineExpenseForm.style.display = 'block');
  }
  if (btnCancelExpense && inlineExpenseForm) {
    btnCancelExpense.addEventListener('click', () => inlineExpenseForm.style.display = 'none');
  }

  if (btnSaveExpense) {
    btnSaveExpense.addEventListener('click', () => {
      const type = DOM.qs('#new-expense-type')?.value || 'مصروف آخر';
      const amount = parseLocalizedFloat(DOM.qs('#new-expense-amount')?.value) || 0;
      const frequency = DOM.qs('#new-expense-frequency')?.value || 'شهري';
      const notes = DOM.qs('#new-expense-notes')?.value.trim() || '';

      if (amount <= 0) {
        showToast('يرجى إدخال مبلغ المصروف بشكل صحيح');
        return;
      }

      expenseItems.push({ type, amount, frequency, notes });
      if (inlineExpenseForm) inlineExpenseForm.style.display = 'none';
      const notesInput = DOM.qs('#new-expense-notes');
      if (notesInput) notesInput.value = '';
      renderExpenseList();
      recalculateBudget();
      showToast('تمت إضافة المصروف بنجاح');
    });
  }

  // إعادة بناء بنود الدخل التلقائية كل مرة تتغيّر فيها بيانات رب الأسرة أو
  // أفراد الأسرة (تكافل وكرامة / الدخل الشهري) في خطوة 1.
  onWorkflowRecalc(syncAutoIncomeItems);
  syncAutoIncomeItems();

  // مزامنة بند "إيجار أراضي زراعية" مع خطوة 5، وعرض القائمة الافتراضية أول مرة.
  onWorkflowRecalc(syncLandRentExpenseItem);
  syncLandRentExpenseItem();
}
