/* --------------------------------------------------------------------------
   OFFICIAL CASE PDF EXPORT SERVICE
   Generates a professional, print-ready, government/charity-grade A4 PDF
   document in Arabic (RTL) from the active case data.
   Features:
     - 100% client-side generation (works offline)
     - Official Institutional Header on every page
     - Official Footer with exact "صفحة X من Y" and timestamp
     - Cairo / Almarai Arabic typography with full ligatures and RTL
     - Smart pagination (sections are never cut mid-content)
     - Safe fallback for null/empty fields (no 'null' or 'undefined')
     - Download, Print & Native Share support
   -------------------------------------------------------------------------- */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { DOM } from '../utils/dom.js';

/** Safe value formatter — never outputs null or undefined */
function val(v, fallback = '—') {
  if (v === undefined || v === null || v === '' || v === 'undefined' || v === 'null') {
    return fallback;
  }
  return String(v).trim() || fallback;
}

/** Format currency */
function money(n) {
  if (n === undefined || n === null || n === '') return '—';
  return `${Number(n || 0).toLocaleString('en-US')} ج.م`;
}

/** Yes / No Arabic representation */
function yesNo(v) {
  if (v === true || v === 'yes' || v === 'true' || v === 1) return 'نعم';
  if (v === false || v === 'no' || v === 'false' || v === 0) return 'لا';
  return '—';
}

/** Sanitize file name for filesystem safety */
function sanitizeFileName(caseId, name) {
  const safeId = String(caseId || 'CASE').replace(/[/\\?%*:|"<>]/g, '-').trim();
  const safeName = String(name || 'مستفيد')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .trim();
  return `Case_${safeId}_${safeName}.pdf`;
}

/** Format date string nicely into DD/MM/YYYY */
function formatDate(d) {
  if (!d) return '—';
  try {
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) return String(d);
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return String(d);
  }
}

/** Current timestamp in Arabic */
function currentTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12 || 12;
  return `${day}/${month}/${year} — ${hours}:${minutes} ${ampm}`;
}

/** Build official Header HTML */
function buildHeaderHtml(c, exportTime) {
  const code = val(c.id, 'CASE');
  const creationDate = formatDate(c.registrationDate || c.createdAtUtc);

  return `
    <div class="pdf-header">
      <div class="pdf-header__top">
        <div class="pdf-header__org">
          <h1 class="pdf-header__org-title">مؤسسة النهضة للعمل الخيري</h1>
          <p class="pdf-header__doc-title">ملف حالة مستفيد — استمارة بحث اجتماعي رسمي</p>
        </div>
        <img src="/assets/logo.png" alt="Logo" class="pdf-header__logo" onerror="this.style.display='none'">
      </div>
      <div class="pdf-header__meta-strip">
        <div class="pdf-header__meta-item">
          <span>رقم الملف / الحالة:</span>
          <strong>${DOM.escapeHTML(code)}</strong>
        </div>
        <div class="pdf-header__meta-item">
          <span>تاريخ إنشاء الملف:</span>
          <strong>${DOM.escapeHTML(creationDate)}</strong>
        </div>
        <div class="pdf-header__meta-item">
          <span>تاريخ تصدير التقرير:</span>
          <strong>${DOM.escapeHTML(exportTime)}</strong>
        </div>
      </div>
    </div>
  `;
}

/** Build official Footer HTML */
function buildFooterHtml(pageNum, totalPages, exportTime) {
  return `
    <div class="pdf-footer">
      <span class="pdf-footer__org">مؤسسة النهضة للعمل الخيري — تقرير رسمي صادر من النظام الآلي</span>
      <span class="pdf-footer__page-num">صفحة ${pageNum} من ${totalPages}</span>
      <span>${exportTime}</span>
    </div>
  `;
}

/**
 * Builds array of discrete section items (HTML strings), ready for packing into pages.
 */
function buildCaseSections(c) {
  const d = c.demographics || {};
  const members = Array.isArray(c.familyMembers) ? c.familyMembers : [];
  const h = c.housing || {};
  const ut = c.utilities || {};
  const services = Array.isArray(ut.services) ? ut.services : [];
  const appliances = Array.isArray(c.appliances) ? c.appliances : [];
  const ag = c.agriculture || {};
  const fin = c.financial || {};
  const incomeItems = Array.isArray(fin.incomeItems) ? fin.incomeItems : [];
  const expenseItems = Array.isArray(fin.expenseItems) ? fin.expenseItems : [];
  const sup = c.support || {};
  const supportTypes = Array.isArray(sup.types) ? sup.types : [];
  const approved = sup.approvedSupport;
  const attachments = Array.isArray(c.attachments) ? c.attachments : [];
  const visits = Array.isArray(c.fieldVisits) ? c.fieldVisits : [];

  const sections = [];

  /* ---- Section 0: ملخص بيانات الحالة ---- */
  const statusLabel = val(c.statusLabel || c.status, 'قيد الدراسة');
  const priorityLabel = val(c.priority || 'عادي');
  sections.push({
    id: 'case-meta',
    html: `
      <div class="pdf-section" style="background: #f8fafc; border: 1.5px solid #cbd5e1;">
        <div class="pdf-section-title">
          <span>📋 بيانات الحالة والملف</span>
          <span class="pdf-badge pdf-badge--info">${DOM.escapeHTML(statusLabel)}</span>
        </div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">اسم المستفيد:</span> <span class="pdf-row__value" style="font-weight: 800; color: #1e3a8a;">${DOM.escapeHTML(val(c.name))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الرقم القومي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.nid))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">درجة الأولوية:</span> <span class="pdf-row__value">${DOM.escapeHTML(priorityLabel)}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المحافظة / المركز:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.center || c.governorate))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">القرية / المنطقة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.village))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الجمعية الشريكة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.charity))}</span></div>
        </div>
      </div>
    `
  });

  /* ---- Section 1: البيانات الشخصية ---- */
  sections.push({
    id: 'personal-data',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>👤 القسم الأول — البيانات الشخصية للمستفيد</span>
        </div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">الاسم بالكامل:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.name))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الرقم القومي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.nid))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">السن / العمر:</span> <span class="pdf-row__value">${d.age ? `${d.age} سنة` : '—'}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">النوع:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.gender))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الحالة الاجتماعية:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.maritalStatus))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المؤهل الدراسي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.education))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المهنة / العمل:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.job || d.employmentStatus))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الهاتف الأساسي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.phonePrimary || c.phone))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الهاتف البديل:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.phoneSecondary))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">محافظة الميلاد:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.birthGovernorate))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">تكافل وكرامة:</span> <span class="pdf-row__value">${yesNo(d.takafulBeneficiary)} ${d.takafulBeneficiary && d.takafulAmount ? `(${money(d.takafulAmount)})` : ''}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الحالة الصحية:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.healthStatus))}</span></div>
        </div>
      </div>
    `
  });

  /* ---- Section 2: بيانات التواصل والعنوان ---- */
  sections.push({
    id: 'address-contact',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>📍 القسم الثاني — بيانات التواصل والعنوان</span>
        </div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">المركز / المدينة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.center))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">القرية / المنطقة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.village))}</span></div>
          ${(c.governorate && c.governorate !== c.center) ? `<div class="pdf-row"><span class="pdf-row__label">المحافظة:</span> <span class="pdf-row__value">${DOM.escapeHTML(c.governorate)}</span></div>` : ''}
          <div class="pdf-row pdf-grid--full"><span class="pdf-row__label">العنوان بالتفصيل:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.address))}</span></div>
        </div>
      </div>
    `
  });

  /* ---- Section 3: بيانات أفراد الأسرة ---- */
  sections.push({
    id: 'family-members',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>👨‍👩‍👧‍👦 القسم الثالث — بيانات أفراد الأسرة التابعين</span>
          <span class="pdf-badge pdf-badge--neutral">${members.length} فرد</span>
        </div>
        ${members.length > 0 ? `
          <table class="pdf-table">
            <thead>
              <tr>
                <th style="width: 22%;">الاسم</th>
                <th style="width: 12%;">صلة القرابة</th>
                <th style="width: 18%;">الرقم القومي</th>
                <th style="width: 8%;">السن</th>
                <th style="width: 14%;">التعليم</th>
                <th style="width: 14%;">العمل / الدخل</th>
                <th style="width: 12%;">تكافل</th>
              </tr>
            </thead>
            <tbody>
              ${members.map(m => `
                <tr>
                  <td><strong>${DOM.escapeHTML(val(m.name))}</strong></td>
                  <td>${DOM.escapeHTML(val(m.relation))}</td>
                  <td style="font-family: monospace; font-size: 10px;">${DOM.escapeHTML(val(m.nid))}</td>
                  <td>${m.age ? `${m.age} سنة` : '—'}</td>
                  <td>${DOM.escapeHTML(val(m.stage || m.education))}</td>
                  <td>${DOM.escapeHTML(val(m.job))} ${m.monthlyIncome ? `(${money(m.monthlyIncome)})` : ''}</td>
                  <td>${yesNo(m.takafulBeneficiary)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <p style="font-size: 11px; color: #64748b; margin: 4px 0; font-style: italic;">لا يوجد أفراد تابعون مسجلون لهذه الحالة.</p>
        `}
      </div>
    `
  });

  /* ---- Section 4: بيانات السكن والمرافق والتجهيزات والأصول ---- */
  const hasLand = ag.hasLand === 'yes' || ag.hasLand === true;
  const hasLivestock = ag.hasLivestock === 'yes' || ag.hasLivestock === true;

  sections.push({
    id: 'housing-assets',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>🏠 القسم الرابع — بيانات السكن والمرافق والتجهيزات والأصول</span>
        </div>

        <div class="pdf-section-subtitle">بيانات المسكن</div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">طبيعة السكن:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.ownership))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">نوع المبنى:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.buildingType))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">نوع الحوائط:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.walls))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">السقف:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.roof))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الأرضية:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.floor))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">عدد الغرف:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.roomsCount))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">دورات المياه:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.bathroomCondition))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الصرف الصحي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.sanitation))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المياه:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.water))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الكهرباء:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.electricity))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">موتور مياه:</span> <span class="pdf-row__value">${yesNo(h.waterMotor)}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الإنترنت:</span> <span class="pdf-row__value">${yesNo(h.internet)}</span></div>
          ${h.description ? `<div class="pdf-row pdf-grid--full"><span class="pdf-row__label">وصف السكن:</span> <span class="pdf-row__value">${DOM.escapeHTML(h.description)}</span></div>` : ''}
        </div>

        ${appliances.length > 0 ? `
          <div class="pdf-section-subtitle">الأجهزة والممتلكات المنزلية</div>
          <div class="pdf-chips-list">
            ${appliances.map(a => `
              <span class="pdf-chip ${a.isPresent ? 'pdf-chip--active' : ''}">${a.isPresent ? '✓' : '—'} ${DOM.escapeHTML(a.label || a.key)}</span>
            `).join('')}
          </div>
        ` : ''}

        <div class="pdf-section-subtitle">الحيازة الزراعية والأصول</div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">حيازة أرض زراعية:</span> <span class="pdf-row__value">${hasLand ? `نعم (${val(ag.landType)} — ${val(ag.landArea)} فدان)` : 'لا'}</span></div>
          ${hasLand && ag.landAnnualIncome ? `<div class="pdf-row"><span class="pdf-row__label">الدخل السنوي من الأرض:</span> <span class="pdf-row__value">${money(ag.landAnnualIncome)}</span></div>` : ''}
          <div class="pdf-row"><span class="pdf-row__label">حيازة مواشي ودواجن:</span> <span class="pdf-row__value">${hasLivestock ? `نعم ${Array.isArray(ag.livestockTypes) && ag.livestockTypes.length ? `(${ag.livestockTypes.join('، ')})` : ''}` : 'لا'}</span></div>
        </div>
      </div>
    `
  });

  /* ---- Section 5: البيانات الاقتصادية والمالية ---- */
  const totalInc = Number(fin.totalIncome || 0);
  const totalExp = Number(fin.totalExpenses || 0);
  const net = Number(fin.netBalance ?? (totalInc - totalExp));

  sections.push({
    id: 'financial-summary',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>💰 القسم الخامس — البيانات الاقتصادية والمالية</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <div class="pdf-section-subtitle" style="margin-top: 0;">مصادر الدخل الشهري</div>
            ${incomeItems.length > 0 ? `
              <table class="pdf-table">
                <thead>
                  <tr>
                    <th>البند / المصدر</th>
                    <th style="width: 35%;">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  ${incomeItems.map(i => `
                    <tr>
                      <td>${DOM.escapeHTML(val(i.label))} ${i.source ? `<span style="font-size: 8.5px; color: #64748b;">(${DOM.escapeHTML(i.source)})</span>` : ''}</td>
                      <td style="color: #047857; font-weight: 700;">${money(i.amount)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `<p style="font-size: 10px; color: #64748b;">لا توجد مصادر دخل مسجلة.</p>`}
          </div>

          <div>
            <div class="pdf-section-subtitle" style="margin-top: 0;">بنود المصروفات الشهرية</div>
            ${expenseItems.length > 0 ? `
              <table class="pdf-table">
                <thead>
                  <tr>
                    <th>نوع المصروف</th>
                    <th style="width: 35%;">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  ${expenseItems.map(e => `
                    <tr>
                      <td>${DOM.escapeHTML(val(e.label))}</td>
                      <td style="color: #be123c; font-weight: 700;">${money(e.amount)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `<p style="font-size: 10px; color: #64748b;">لا توجد مصروفات مسجلة.</p>`}
          </div>
        </div>

        <div class="pdf-fin-summary">
          <div class="pdf-fin-stat">
            <span class="pdf-fin-stat__label">إجمالي الدخل الشهري</span>
            <span class="pdf-fin-stat__val" style="color: #047857;">${money(totalInc)}</span>
          </div>
          <div class="pdf-fin-stat">
            <span class="pdf-fin-stat__label">إجمالي المصروفات الشهرية</span>
            <span class="pdf-fin-stat__val" style="color: #be123c;">${money(totalExp)}</span>
          </div>
          <div class="pdf-fin-stat" style="background: ${net < 0 ? '#fff1f2' : '#f0fdf4'}; border-color: ${net < 0 ? '#fecdd3' : '#bbf7d0'};">
            <span class="pdf-fin-stat__label">${net < 0 ? 'العجز الشهري' : 'صافي الدخل'}</span>
            <span class="pdf-fin-stat__val" style="color: ${net < 0 ? '#be123c' : '#047857'};">${money(net)}</span>
          </div>
        </div>
      </div>
    `
  });

  /* ---- Section 6: التقييم والبحث الاجتماعي والآراء ---- */
  const workerOp = c.workerOpinion;
  const reviewerOp = c.reviewerOpinion;
  const managerOp = c.managerApproval;

  sections.push({
    id: 'assessment-opinions',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>📋 القسم السادس — التقييم والبحث الاجتماعي والتوصيات</span>
        </div>

        ${workerOp ? `
          <div class="pdf-section-subtitle" style="display: flex; justify-content: space-between;">
            <span>رأي وتقرير الأخصائي الاجتماعي الميداني:</span>
            <span class="pdf-badge pdf-badge--info">${DOM.escapeHTML(val(workerOp.decision, 'مسجل'))}</span>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.6; color: #1e293b;">
            "${DOM.escapeHTML(val(workerOp.notes, 'لا توجد ملاحظات تفصيلية'))}"
          </div>
          ${workerOp.author ? `
            <div style="font-size: 10px; color: #64748b; margin-top: 3px; font-weight: 700;">
              الأخصائي: ${DOM.escapeHTML(workerOp.author)} ${workerOp.date ? `(${formatDate(workerOp.date)})` : ''}
            </div>
          ` : ''}
        ` : ''}

        ${supportTypes.length > 0 ? `
          <div class="pdf-section-subtitle" style="margin-top: 8px;">أنواع الدعم المقترحة من الأخصائي:</div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th>نوع الدعم المقترح</th>
                <th>الفئة / التصنيف</th>
                <th>المبلغ المقترح</th>
                <th>درجة الأولوية</th>
              </tr>
            </thead>
            <tbody>
              ${supportTypes.map(s => `
                <tr>
                  <td><strong>${DOM.escapeHTML(val(s.title))}</strong></td>
                  <td>${DOM.escapeHTML(val(s.option))}</td>
                  <td style="color: #047857; font-weight: 700;">${val(s.amount)}</td>
                  <td><span class="pdf-badge pdf-badge--warning">${DOM.escapeHTML(val(s.urgency))}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        ${approved ? `
          <div style="margin-top: 8px; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 6px; padding: 8px 10px;">
            <div style="font-size: 11.5px; font-weight: 800; color: #15803d; margin-bottom: 4px;">✅ الدعم المعتمد نهائيًا</div>
            <div class="pdf-grid pdf-grid--3col">
              <div class="pdf-row"><span class="pdf-row__label">نوع الدعم:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(approved.type))}</span></div>
              <div class="pdf-row"><span class="pdf-row__label">المبلغ:</span> <span class="pdf-row__value" style="color: #047857; font-weight: 800;">${DOM.escapeHTML(val(approved.amount))}</span></div>
              <div class="pdf-row"><span class="pdf-row__label">تاريخ الاعتماد:</span> <span class="pdf-row__value">${formatDate(approved.approvedAt)}</span></div>
            </div>
            ${approved.notes ? `<div style="font-size: 10.5px; margin-top: 4px; color: #166534;"><strong>ملاحظات الاعتماد:</strong> ${DOM.escapeHTML(approved.notes)}</div>` : ''}
          </div>
        ` : ''}

        ${(reviewerOp && reviewerOp.decision) || (managerOp && managerOp.decision) ? `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
            ${reviewerOp && reviewerOp.decision ? `
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px;">
                <div style="font-size: 10.5px; font-weight: 800; color: #1d4ed8; margin-bottom: 2px;">قرار وتوصية المراجع: ${DOM.escapeHTML(reviewerOp.decision)}</div>
                <div style="font-size: 10px; color: #334155;">${DOM.escapeHTML(val(reviewerOp.notes))}</div>
                ${reviewerOp.author ? `<div style="font-size: 9px; color: #64748b; margin-top: 2px;">المراجع: ${DOM.escapeHTML(reviewerOp.author)}</div>` : ''}
              </div>
            ` : '<div></div>'}
            ${managerOp && managerOp.decision ? `
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px;">
                <div style="font-size: 10.5px; font-weight: 800; color: #047857; margin-bottom: 2px;">الاعتماد النهائي للمدير: ${DOM.escapeHTML(managerOp.decision)}</div>
                <div style="font-size: 10px; color: #334155;">${DOM.escapeHTML(val(managerOp.notes))}</div>
                ${managerOp.author ? `<div style="font-size: 9px; color: #64748b; margin-top: 2px;">المدير: ${DOM.escapeHTML(managerOp.author)}</div>` : ''}
              </div>
            ` : '<div></div>'}
          </div>
        ` : ''}
      </div>
    `
  });

  /* ---- Section 7: الزيارات الميدانية (تُعرض فقط إن وُجدت) ---- */
  if (visits.length > 0) {
    sections.push({
      id: 'field-visits',
      html: `
        <div class="pdf-section">
          <div class="pdf-section-title">
            <span>🚗 القسم السابع — الزيارات الميدانية والمتابعة</span>
            <span class="pdf-badge pdf-badge--neutral">${visits.length} زيارة</span>
          </div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th style="width: 18%;">تاريخ الزيارة</th>
                <th style="width: 20%;">الباحث الميداني</th>
                <th style="width: 18%;">النتيجة / الحالة</th>
                <th>تقرير وملاحظات الزيارة</th>
              </tr>
            </thead>
            <tbody>
              ${visits.map(v => `
                <tr>
                  <td>${formatDate(v.visitDate || v.createdAt)}</td>
                  <td>${DOM.escapeHTML(val(v.workerName || v.author))}</td>
                  <td><span class="pdf-badge pdf-badge--info">${DOM.escapeHTML(val(v.outcome || v.status))}</span></td>
                  <td>${DOM.escapeHTML(val(v.notes || v.description))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `
    });
  }

  /* ---- Section 8: المرفقات والوثائق المسجلة (تُعرض فقط إن وُجدت) ---- */
  if (attachments.length > 0) {
    sections.push({
      id: 'attachments-table',
      html: `
        <div class="pdf-section">
          <div class="pdf-section-title">
            <span>📁 القسم الثامن — قائمة المرفقات والوثائق المسجلة</span>
            <span class="pdf-badge pdf-badge--neutral">${attachments.length} وثيقة</span>
          </div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th style="width: 35%;">اسم المستند / الملف</th>
                <th style="width: 25%;">نوع الوثيقة</th>
                <th style="width: 20%;">تاريخ الرفع</th>
                <th style="width: 20%;">حالة المستند</th>
              </tr>
            </thead>
            <tbody>
              ${attachments.map(a => `
                <tr>
                  <td><strong>${DOM.escapeHTML(val(a.fileName || a.title))}</strong></td>
                  <td>${DOM.escapeHTML(val(a.docType || a.documentType))}</td>
                  <td>${formatDate(a.uploadedAt || a.createdAt)}</td>
                  <td><span class="pdf-badge pdf-badge--success">${DOM.escapeHTML(val(a.status, 'مكتمل'))}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `
    });
  }

  return sections;
}

/**
 * Intelligent section packer:
 * Measures actual rendered height of each section card and allocates cards
 * into pages to guarantee no mid-section cuts and consistent headers/footers.
 */
function packSectionsIntoPages(sections, headerHeight = 100, footerHeight = 40) {
  // A4 = 1123px height. Padding = 44px. Header = 100px. Footer = 40px.
  // Net safe page budget:
  const PAGE_CAPACITY = 880;

  const stage = document.createElement('div');
  stage.className = 'pdf-export-stage';
  stage.style.visibility = 'hidden';
  document.body.appendChild(stage);

  // Measure all sections
  const measured = sections.map(s => {
    const el = document.createElement('div');
    el.innerHTML = s.html;
    stage.appendChild(el);
    const height = el.firstElementChild ? el.firstElementChild.offsetHeight + 10 : 150;
    return { ...s, height };
  });

  stage.remove();

  // Distribute into pages
  const pages = [];
  let currentPage = [];
  let currentHeight = 0;

  for (const item of measured) {
    if (currentHeight + item.height > PAGE_CAPACITY && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [item];
      currentHeight = item.height;
    } else {
      currentPage.push(item);
      currentHeight += item.height;
    }
  }
  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/**
 * Main export function:
 * Exports current case data to an official A4 PDF, downloads it to device,
 * and provides print/share options.
 *
 * @param {Object} caseData - The current normalized active case object.
 * @param {Object} [options] - Optional export configurations.
 * @returns {Promise<{ fileName: string, doc: jsPDF, blob: Blob }>}
 */
export async function exportCaseToPdf(caseData, options = {}) {
  if (!caseData) throw new Error('لا توجد بيانات حالة لتصديرها');

  const exportTime = currentTimestamp();
  const rawSections = buildCaseSections(caseData);
  const pages = packSectionsIntoPages(rawSections);
  const totalPages = pages.length;

  // Mount stage container for html2canvas
  const stage = document.createElement('div');
  stage.className = 'pdf-export-stage';
  stage.id = 'pdf-export-stage';

  const pageElements = [];

  for (let i = 0; i < totalPages; i++) {
    const pageNum = i + 1;
    const items = pages[i];

    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-page';
    pageEl.innerHTML = `
      ${buildHeaderHtml(caseData, exportTime)}
      <div class="pdf-body">
        ${items.map(it => it.html).join('')}
      </div>
      ${buildFooterHtml(pageNum, totalPages, exportTime)}
    `;

    stage.appendChild(pageEl);
    pageElements.push(pageEl);
  }

  document.body.appendChild(stage);

  try {
    // Wait for fonts & layout stabilization
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    await new Promise(r => setTimeout(r, 120));

    // Initialize jsPDF document (A4 portrait)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    for (let i = 0; i < pageElements.length; i++) {
      const pageEl = pageElements[i];

      const canvas = await html2canvas(pageEl, {
        scale: 2, // 2x DPI for razor-sharp crisp Arabic text & lines
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      if (i > 0) {
        doc.addPage('a4', 'portrait');
      }

      // Exact A4 dimensions in mm: 210 x 297
      doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }

    const fileName = sanitizeFileName(caseData.id, caseData.name);

    // Save directly to device
    doc.save(fileName);

    const blob = doc.output('blob');

    return { fileName, doc, blob };
  } finally {
    stage.remove();
  }
}
