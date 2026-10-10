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
import { supportTypeLabel } from '../utils/support-labels.js';
import { documentTypeLabel } from './document-types.js';

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

/** Arabic gender label — API returns "male"/"female" for the head of household. */
function genderLabel(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'male' || s === 'm' || s === 'ذكر') return 'ذكر';
  if (s === 'female' || s === 'f' || s === 'أنثى' || s === 'انثى') return 'أنثى';
  return val(v);
}

/** Arabic label + color for a workflow decision enum (accepted/rejected/approved/returned_to_worker). */
const DECISION_META = {
  accepted: { label: 'مقبول', color: '#047857' },
  approved: { label: 'مقبول', color: '#047857' },
  rejected: { label: 'مرفوض', color: '#be123c' },
  returned_to_worker: { label: 'معاد للأخصائي', color: '#b45309' }
};

/** Renders a decision enum as a colored Arabic <span>, or a muted fallback if not recorded. */
function decisionHtml(decision, fallback = 'مسجل') {
  const meta = DECISION_META[decision];
  // أي قيمة قرار غير معروفة (إنجليزية من الباك إند) تتعرض بنص عربي عام بدل الكلمة الخام.
  if (!meta) return DOM.escapeHTML(/[A-Za-z]/.test(String(decision || '')) ? fallback : val(decision, fallback));
  return `<span style="color: ${meta.color}; font-weight: 800;">${meta.label}</span>`;
}

/** True when an opinion has a decision or any notes — otherwise it's treated as "not recorded yet". */
function hasOpinion(op) {
  return Boolean(op && (op.decision || (op.notes && String(op.notes).trim())));
}

/** Reviewer/manager opinion card — always rendered; shows an explicit empty state when nothing is recorded. */
function opinionCardHtml(op, { title, color, roleLabel, emptyText }) {
  if (!hasOpinion(op)) {
    return `
      <div class="pdf-opinion pdf-opinion--empty">
        <div style="font-size: 10.5px; font-weight: 800; color: ${color}; margin-bottom: 2px;">${title}:</div>
        <div class="pdf-opinion__empty-text">${emptyText}</div>
      </div>
    `;
  }
  return `
    <div class="pdf-opinion">
      <div style="font-size: 10.5px; font-weight: 800; color: ${color}; margin-bottom: 2px;">${title}: ${decisionHtml(op.decision)}</div>
      <div style="font-size: 10px; color: #334155;">${DOM.escapeHTML(val(op.notes, 'لا توجد ملاحظات'))}</div>
      ${op.author && !op.isLegacyImport ? `<div style="font-size: 9px; color: #64748b; margin-top: 2px;">${roleLabel}: ${DOM.escapeHTML(op.author)}</div>` : ''}
    </div>
  `;
}

/** Sanitize file name for filesystem safety */
function sanitizeFileName(caseId, name) {
  const safeId = String(caseId || 'بدون_رقم').replace(/[/\\?%*:|"<>]/g, '-').trim();
  const safeName = String(name || 'مستفيد')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .trim();
  return `حالة_${safeId}_${safeName}.pdf`;
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
  const code = val(c.id, 'بدون رقم');
  const creationDate = formatDate(c.registrationDate || c.createdAtUtc);

  return `
    <div class="pdf-header">
      <div class="pdf-header__top">
        <div class="pdf-header__org">
          <h1 class="pdf-header__org-title">مؤسسه نهضة بني سويف</h1>
          <p class="pdf-header__license">المشهرة برقم 1079 لسنة 2009</p>
        </div>
        <img src="/assets/logo.png" alt="شعار المؤسسة" class="pdf-header__logo" onerror="this.style.display='none'">
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
      <div class="pdf-footer__info">
        <span class="pdf-footer__org">مؤسسه نهضة بني سويف</span>
        <span class="pdf-footer__page-num">صفحة ${pageNum} من ${totalPages}</span>
        <span>${exportTime}</span>
      </div>
      <div class="pdf-footer__partners">
        <img src="/assets/devx_logo.jpg" alt="شعار الشريك التقني" class="pdf-footer__partner-logo" onerror="this.style.display='none'">
        <span class="pdf-footer__partners-amp">و</span>
        <img src="/assets/delmon_logo.jpeg" alt="شعار الشريك" class="pdf-footer__partner-logo pdf-footer__partner-logo--round" onerror="this.style.display='none'">
      </div>
    </div>
  `;
}

/**
 * Doc title for the delivery roster ("كشف ...") — driven by the selected
 * support type(s). Falls back to a generic title when no single support
 * type was picked (e.g. charity-only filter, or several types at once).
 */
function deliveryRosterTitle(meta) {
  const types = Array.isArray(meta.supportTypes) ? meta.supportTypes.filter(Boolean).map(supportTypeLabel) : [];
  if (types.length === 1) return `كشف ${types[0]}`;
  if (types.length > 1) return `كشف ${types.join(' / ')}`;
  return 'كشف الدعم';
}

/**
 * Header for the "كشف تسليم/استلام دعم" roster — official layout matching
 * the charity's printed delivery-roster convention:
 *   - top-right: institution name + registration number + mission line
 *   - top-center: the institution logo
 *   - top-left: مركز/قرية/جمعية labels+values
 *   - a centered doc title driven by the selected support type(s)
 */
function buildListHeaderHtml(meta) {
  return `
    <div class="pdf-header pdf-header--roster">
      <div class="pdf-header__top">
        <div class="pdf-header__org" style="text-align: right;">
          <h1 class="pdf-header__org-title">مؤسسة نهضة بني سويف</h1>
          <p class="pdf-header__license">المشهرة برقم 1079 لسنة 2009</p>
          <p class="pdf-header__mission">التنمية الشاملة المستدامة</p>
        </div>
        <img src="/assets/logo.png" alt="شعار المؤسسة" class="pdf-header__seal" onerror="this.style.display='none'">
        <div class="pdf-header__roster-left">
          <div class="pdf-header__roster-left-meta">
            <div class="pdf-header__meta-item">
              <span>المركز:</span>
              <strong>${DOM.escapeHTML(val(meta.centerLabel, '—'))}</strong>
            </div>
            <div class="pdf-header__meta-item">
              <span>القرية:</span>
              <strong>${DOM.escapeHTML(val(meta.villageLabel, '—'))}</strong>
            </div>
            <div class="pdf-header__meta-item">
              <span>الجمعية:</span>
              <strong>${DOM.escapeHTML(val(meta.charityLabel, 'جميع الجمعيات'))}</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="pdf-header__roster-title">
        <h2>${DOM.escapeHTML(deliveryRosterTitle(meta))}</h2>
        <span class="pdf-header__roster-count">إجمالي الحالات: ${DOM.escapeHTML(String(meta.total ?? 0))}</span>
      </div>
    </div>
  `;
}

/**
 * One <tr> for the delivery roster table — الكود، الاسم، المحمول، الرقم القومي، القرية، الكمية، التوقيع.
 * A null `row` renders a blank filler line (the last page is padded to a full 20 lines).
 */
function caseListRowHtml(row, index, heightPx) {
  const heightStyle = heightPx ? ` style="height: ${heightPx.toFixed(2)}px;"` : '';

  if (!row) {
    return `<tr${heightStyle}>${'<td>&nbsp;</td>'.repeat(8)}</tr>`;
  }

  const matched = Array.isArray(row.matchedSupport) ? row.matchedSupport : [];
  const quantity = matched.length
    ? matched.map(m => m.totalCount ?? 0).reduce((a, b) => a + b, 0)
    : '—';

  return `
    <tr${heightStyle}>
      <td style="text-align: center;">${index + 1}</td>
      <td>${DOM.escapeHTML(val(row.displayId || row.caseNumber || row.id))}</td>
      <td>${DOM.escapeHTML(val(row.beneficiaryFullName))}</td>
      <td style="font-family: monospace;">${DOM.escapeHTML(val(row.phonePrimary))}</td>
      <td style="font-family: monospace;">${DOM.escapeHTML(val(row.nationalId))}</td>
      <td>${DOM.escapeHTML(val(row.villageName))}</td>
      <td style="text-align: center;">${DOM.escapeHTML(String(quantity))}</td>
      <td></td>
    </tr>
  `;
}

// Fixed page size (product requirement) — the table shrinks to fit this
// many rows, rather than the row count adapting to available space.
const ROSTER_ROWS_PER_PAGE = 20;
const ROSTER_DEFAULT_FONT_PX = 14;
const ROSTER_DEFAULT_PADDING = { v: 6, h: 8 };
const ROSTER_MIN_FONT_PX = 8; // floor — below this the roster stops shrinking and may overflow rather than become unreadable.
// Sub-pixel rounding across 20 rows adds up; this cushion keeps the last row
// from being clipped by the page's overflow: hidden.
const ROSTER_FIT_SAFETY_PX = 6;

function rosterTableStyle(fontPx, padV) {
  return `--roster-font-size: ${fontPx}px; --roster-cell-padding: ${padV}px ${ROSTER_DEFAULT_PADDING.h}px;`;
}

/**
 * Splits rows into pages of up to 20 lines. Full pages have their line
 * heights stretched so the table fills the space above the acknowledgement
 * block; the last (partial) page is NOT padded with blank lines — it just
 * ends and leaves empty space. Measured on real roster pages, so wrapped
 * names are accounted for; the table font only shrinks when 20
 * natural-height lines can't fit at all.
 */
function packRosterRows(rows, meta) {
  const stage = document.createElement('div');
  stage.className = 'pdf-export-stage';
  stage.style.visibility = 'hidden';
  document.body.appendChild(stage);

  const headerHtml = buildListHeaderHtml({ ...meta, total: meta.total ?? rows.length });

  function mountMeasurePage(tableRows, tableStyle) {
    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-page pdf-page--roster';
    pageEl.innerHTML = `
      ${headerHtml}
      <div class="pdf-body">${listReportTableHtml(tableRows, 0, tableStyle)}</div>
      ${rosterAcknowledgementHtml()}
      ${buildFooterHtml(1, 1, '')}
    `;
    stage.appendChild(pageEl);
    return pageEl;
  }

  function measureAt(fontPx, padV) {
    const tableStyle = rosterTableStyle(fontPx, padV);

    // Room for tbody lines = the gap between the (empty) table and the
    // acknowledgement block, which is pinned to the bottom of the page above
    // the footer. 6px is the minimum breathing gap kept above the block.
    const emptyPage = mountMeasurePage([], tableStyle);
    const ack = emptyPage.querySelector('.pdf-roster-ack');
    const body = emptyPage.querySelector('.pdf-body');
    const rowSpace = ack.offsetTop - (body.offsetTop + body.offsetHeight) - 6 - ROSTER_FIT_SAFETY_PX;
    emptyPage.remove();

    // Natural height of every real row. The roster table uses fixed column
    // widths, so a row wraps here exactly as it will on its real page.
    const fullPage = mountMeasurePage(rows, tableStyle);
    const heights = [...fullPage.querySelectorAll('tbody tr')].map(tr => tr.offsetHeight);
    fullPage.remove();

    return { tableStyle, rowSpace, rowHeights: heights };
  }

  const chunks = [];
  for (let i = 0; i < rows.length; i += ROSTER_ROWS_PER_PAGE) {
    chunks.push({ start: i, count: Math.min(ROSTER_ROWS_PER_PAGE, rows.length - i) });
  }
  if (chunks.length === 0) chunks.push({ start: 0, count: 0 });

  const naturalPageHeight = (m, { start, count }) => {
    let sum = 0;
    for (let i = start; i < start + count; i++) sum += m.rowHeights[i];
    return sum;
  };

  let fontPx = ROSTER_DEFAULT_FONT_PX;
  let padV = ROSTER_DEFAULT_PADDING.v;
  let m = measureAt(fontPx, padV);

  while (Math.max(...chunks.map(c => naturalPageHeight(m, c))) > m.rowSpace && fontPx > ROSTER_MIN_FONT_PX) {
    fontPx = Math.max(ROSTER_MIN_FONT_PX, fontPx - 0.5);
    padV = Math.max(2, padV - 0.25);
    m = measureAt(fontPx, padV);
  }

  stage.remove();

  const pages = chunks.map(chunk => {
    // الصفحة الأخيرة (أقل من 20 حالة) ما بتتملاش بصفوف فاضية — بيفضل تحت الجدول مسافة فاضية.
    const pageRows = rows.slice(chunk.start, chunk.start + chunk.count);

    // الصفحات الكاملة (20 صف) بس هي اللي بنوزّع عليها المساحة المتبقية.
    const isFull = chunk.count === ROSTER_ROWS_PER_PAGE;
    const extraPerRow = isFull
      ? Math.max(0, m.rowSpace - naturalPageHeight(m, chunk)) / ROSTER_ROWS_PER_PAGE
      : 0;
    const heights = pageRows.map((row, i) => m.rowHeights[chunk.start + i] + extraPerRow);

    return { rows: pageRows, heights, dataCount: chunk.count };
  });

  return { pages, tableStyle: m.tableStyle };
}

function listReportTableHtml(pageRows, startIndex, tableStyleOverride = '', rowHeights = []) {
  return `
    <div class="pdf-section" style="flex: none;">
      <table class="pdf-table pdf-roster-table" style="${tableStyleOverride}">
        <colgroup>
          <col style="width: 4%;">
          <col style="width: 9%;">
          <col style="width: 22%;">
          <col style="width: 14%;">
          <col style="width: 18%;">
          <col style="width: 12%;">
          <col style="width: 7%;">
          <col style="width: 14%;">
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>الكود</th>
            <th>اسم الحالة</th>
            <th>المحمول</th>
            <th>الرقم القومي</th>
            <th>القرية</th>
            <th>الكمية</th>
            <th>التوقيع</th>
          </tr>
        </thead>
        <tbody>
          ${pageRows.map((row, i) => caseListRowHtml(row, startIndex + i, rowHeights[i])).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/** Footer acknowledgement block — the charity's data/signature attestation, printed above the page footer on every page. */
function rosterAcknowledgementHtml() {
  return `
    <div class="pdf-roster-ack">
      <p class="pdf-roster-ack__statement">
        إقرار الجمعية بصحة البيانات والتوقيعات وأن التسليم تم للحالات الموجودة بالكشف تحت مسؤوليتي
      </p>
      <p class="pdf-roster-ack__note">
        ملحوظة: يجب أن تكون بطاقة الرقم القومي سارية
      </p>
      <div class="pdf-roster-ack__signatures">
        <div class="pdf-signature-box">
          <span class="pdf-signature-box__role">رئيس مجلس الإدارة</span>
          <span class="pdf-signature-box__line"></span>
          <span class="pdf-signature-box__caption">التوقيع والختم</span>
        </div>
        <div class="pdf-signature-box">
          <span class="pdf-signature-box__role">مسؤول التسليم</span>
          <span class="pdf-signature-box__line"></span>
          <span class="pdf-signature-box__caption">التوقيع</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Exports a filtered case list (charity + support-type filter, from
 * GET /search/cases) to an official A4 PDF laid out as a printed
 * "كشف تسليم/استلام دعم" delivery roster — charity seal + مركز/قرية on the
 * top-left, institution name/registration/mission on the top-right, a
 * doc title driven by the selected support type ("كشف <النوع>"),
 * and a data/signature acknowledgement + رئيس مجلس الإدارة / مسؤول التسليم
 * signature boxes repeated at the bottom of every page.
 *
 * @param {Array<Object>} rows - normalized search-result items (id, displayId/caseNumber,
 *   beneficiaryFullName, phonePrimary, nationalId, charityName, centerName, villageName,
 *   status/statusLabel, matchedSupport?)
 * @param {Object} meta - { charityLabel, centerLabel, villageLabel, supportTypes: string[], total }
 * @returns {Promise<{ fileName: string, doc: jsPDF, blob: Blob }>}
 */
export async function exportCaseListToPdf(rows, meta = {}) {
  if (!Array.isArray(rows)) throw new Error('لا توجد بيانات لتصديرها');

  const exportTime = currentTimestamp();

  // Row heights are measured in packRosterRows — fonts must be final first,
  // or the measured lines won't match what html2canvas later captures.
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const { pages, tableStyle } = packRosterRows(rows, meta);
  const totalPages = pages.length;

  const stage = document.createElement('div');
  stage.className = 'pdf-export-stage';
  stage.id = 'pdf-list-export-stage';

  const pageElements = [];
  let runningIndex = 0;

  for (let i = 0; i < totalPages; i++) {
    const pageNum = i + 1;
    const page = pages[i];

    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-page pdf-page--roster';
    pageEl.innerHTML = `
      ${buildListHeaderHtml({ ...meta, total: meta.total ?? rows.length })}
      <div class="pdf-body">
        ${listReportTableHtml(page.rows, runningIndex, tableStyle, page.heights)}
      </div>
      ${rosterAcknowledgementHtml()}
      ${buildFooterHtml(pageNum, totalPages, exportTime)}
    `;

    runningIndex += page.dataCount;
    stage.appendChild(pageEl);
    pageElements.push(pageEl);
  }

  document.body.appendChild(stage);

  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const images = [...stage.querySelectorAll('img')];
    await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));

    await new Promise(r => setTimeout(r, 120));

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    for (let i = 0; i < pageElements.length; i++) {
      const pageEl = pageElements[i];

      const canvas = await html2canvas(pageEl, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      if (i > 0) {
        doc.addPage('a4', 'portrait');
      }

      doc.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }

    const safeCharity = String(meta.charityLabel || 'الكل').replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
    const fileName = `تقرير_الحالات_${safeCharity}_${Date.now()}.pdf`;

    doc.save(fileName);

    const blob = doc.output('blob');

    return { fileName, doc, blob };
  } finally {
    stage.remove();
  }
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
  // البنود بمبلغ صفر (أو فاضي) مابتظهرش في الجداول — الإجماليات تحت بتفضل زي ما هي.
  const nonZero = i => Number(i && i.amount) > 0;
  const incomeItems = (Array.isArray(fin.incomeItems) ? fin.incomeItems : []).filter(nonZero);
  const expenseItems = (Array.isArray(fin.expenseItems) ? fin.expenseItems : []).filter(nonZero);
  const sup = c.support || {};
  const supportTypes = Array.isArray(sup.types) ? sup.types : [];
  const approved = sup.approvedSupport;
  const attachments = Array.isArray(c.attachments) ? c.attachments : [];
  const visits = Array.isArray(c.fieldVisits) ? c.fieldVisits : [];

  const sections = [];

  /* ---- Section 0: بيانات الحالة ---- */
  const statusLabel = val(c.statusLabel || c.status, 'قيد الدراسة');
  const legacy = c.legacyImportData;
  sections.push({
    id: 'case-meta',
    html: `
      <div class="pdf-section pdf-section--heavy" style="background: #f8fafc; border: 1.5px solid #cbd5e1;">
        <div class="pdf-section-title">
          <span>📋 بيانات الحالة</span>
          <span class="pdf-badge pdf-badge--info">${DOM.escapeHTML(statusLabel)}</span>
        </div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">اسم المستفيد:</span> <span class="pdf-row__value" style="color: #1e3a8a;">${DOM.escapeHTML(val(c.name))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الرقم القومي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.nid))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الديانة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.religion))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المحافظة / المركز:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.center || c.governorate))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">القرية / المنطقة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.village))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الجمعية الشريكة:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(c.charity))}</span></div>
        </div>
        ${legacy && legacy.researcherName ? `
          <div style="margin-top: 10px; background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 13px; font-weight: 800; color: #1d4ed8;">👤 الباحث الأصلي لهذه الحالة:</span>
            <span style="font-size: 15px; font-weight: 800; color: #1e3a8a;">${DOM.escapeHTML(legacy.researcherName)}</span>
          </div>
        ` : ''}
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
          <div class="pdf-row"><span class="pdf-row__label">السن / العمر:</span> <span class="pdf-row__value">${d.age ? `${d.age} سنة` : '—'}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">النوع:</span> <span class="pdf-row__value">${DOM.escapeHTML(genderLabel(d.gender))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الحالة الاجتماعية:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.maritalStatus))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المؤهل الدراسي:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.education))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">المهنة / العمل:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.job || d.employmentStatus))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الهاتف الأساسي:</span> <span class="pdf-row__value pdf-row__value--phone">${DOM.escapeHTML(val(d.phonePrimary || c.phone))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الهاتف البديل:</span> <span class="pdf-row__value pdf-row__value--phone">${DOM.escapeHTML(val(d.phoneSecondary))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">تكافل وكرامة:</span> <span class="pdf-row__value">${yesNo(d.takafulBeneficiary)} ${d.takafulBeneficiary && d.takafulAmount ? `(${money(d.takafulAmount)})` : ''}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">الحالة الصحية:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(d.healthStatus))}</span></div>
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
          <span>👨‍👩‍👧‍👦 القسم الثاني — بيانات أفراد الأسرة التابعين</span>
          <span class="pdf-badge pdf-badge--info" style="font-size: 13px; padding: 3px 10px;">${members.length} فرد</span>
        </div>
        ${members.length > 0 ? `
          <table class="pdf-table">
            <thead>
              <tr>
                <th style="width: 16%;">الاسم</th>
                <th style="width: 10%;">صلة القرابة</th>
                <th style="width: 14%;">الرقم القومي</th>
                <th style="width: 6%;">السن</th>
                <th style="width: 7%;">النوع</th>
                <th style="width: 14%;">التعليم / المرحلة</th>
                <th style="width: 12%;">العمل / الدخل</th>
                <th style="width: 10%;">تكافل وكرامة</th>
                <th style="width: 10%;">الأمراض</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              ${members.map(m => {
      const eduParts = [];
      if (m.isStudent) {
        eduParts.push('طالب');
        if (m.stage) eduParts.push(m.stage);
        if (m.grade) eduParts.push(m.grade);
        if (m.university) eduParts.push(m.university);
      } else if (m.education) {
        eduParts.push(m.education);
      }
      const eduText = eduParts.filter(Boolean).join(' — ') || '—';
      const takafulText = m.takafulBeneficiary
        ? `نعم${m.takafulAmount ? ` (${money(m.takafulAmount)})` : ''}`
        : 'لا';
      return `
                <tr>
                  <td><strong>${DOM.escapeHTML(val(m.name))}</strong></td>
                  <td>${DOM.escapeHTML(val(m.relation))}</td>
                  <td style="font-family: monospace; font-size: 10px;">${DOM.escapeHTML(val(m.nid))}</td>
                  <td>${m.age ? `${m.age} سنة` : '—'}</td>
                  <td>${DOM.escapeHTML(genderLabel(m.gender))}</td>
                  <td>${DOM.escapeHTML(eduText)}</td>
                  <td>${DOM.escapeHTML(val(m.job))} ${m.monthlyIncome ? `(${money(m.monthlyIncome)})` : ''}</td>
                  <td>${DOM.escapeHTML(takafulText)}</td>
                  <td>${DOM.escapeHTML(val(m.diseases))}</td>
                  <td>${DOM.escapeHTML(val(m.notes))}</td>
                </tr>
              `;
    }).join('')}
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
          <span>🏠 القسم الثالث — بيانات السكن والمرافق والتجهيزات والأصول</span>
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
          <div class="pdf-row"><span class="pdf-row__label">المدخل:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.entrance))}</span></div>
          <div class="pdf-row"><span class="pdf-row__label">وسيلة المواصلات:</span> <span class="pdf-row__value">${DOM.escapeHTML(val(h.transport))}</span></div>
        </div>
        <div class="pdf-section-subtitle">وصف السكن</div>
        <div class="pdf-row"><span class="pdf-row__value">${DOM.escapeHTML(val(h.description))}</span></div>

        ${appliances.some(a => a.isPresent) ? `
          <div class="pdf-section-subtitle">الأجهزة والممتلكات المنزلية</div>
          <div class="pdf-chips-list">
            ${appliances.filter(a => a.isPresent).map(a => `
              <span class="pdf-chip pdf-chip--active">✓ ${DOM.escapeHTML(a.label || a.key)}</span>
            `).join('')}
          </div>
        ` : ''}

        ${services.length > 0 ? `
          <div class="pdf-section-subtitle">مرافق إضافية</div>
          <div class="pdf-grid pdf-grid--3col">
            ${services.map(s => `
              <div class="pdf-row"><span class="pdf-row__label">${DOM.escapeHTML(val(s.name, 'مرفق'))}:</span> <span class="pdf-row__value">${yesNo(s.isAvailable)}${s.condition ? ` — ${DOM.escapeHTML(s.condition)}` : ''}${s.sourceOrMeter ? ` (${DOM.escapeHTML(s.sourceOrMeter)})` : ''}</span></div>
            `).join('')}
          </div>
        ` : ''}

        <div class="pdf-section-subtitle">الحيازة الزراعية والأصول</div>
        <div class="pdf-grid pdf-grid--3col">
          <div class="pdf-row"><span class="pdf-row__label">حيازة أرض زراعية:</span> <span class="pdf-row__value">${hasLand ? `نعم (${val(ag.landType)} — ${val(ag.landArea)} فدان)` : 'لا'}</span></div>
          ${hasLand && ag.landRentAmount ? `<div class="pdf-row"><span class="pdf-row__label">قيمة الإيجار:</span> <span class="pdf-row__value">${money(ag.landRentAmount)}</span></div>` : ''}
          ${hasLand && ag.landAnnualIncome ? `<div class="pdf-row"><span class="pdf-row__label">الدخل السنوي من الأرض:</span> <span class="pdf-row__value">${money(ag.landAnnualIncome)}</span></div>` : ''}
          <div class="pdf-row"><span class="pdf-row__label">حيازة مواشي ودواجن:</span> <span class="pdf-row__value">${hasLivestock ? `نعم ${Array.isArray(ag.livestockTypes) && ag.livestockTypes.length ? `(${ag.livestockTypes.join('، ')})` : ''}` : 'لا'}</span></div>
          ${hasLivestock && ag.livestockDetails ? `<div class="pdf-row pdf-grid--full"><span class="pdf-row__label">تفاصيل المواشي:</span> <span class="pdf-row__value">${DOM.escapeHTML(ag.livestockDetails)}</span></div>` : ''}
          ${ag.notes ? `<div class="pdf-row pdf-grid--full"><span class="pdf-row__label">ملاحظات الحيازة الزراعية:</span> <span class="pdf-row__value">${DOM.escapeHTML(ag.notes)}</span></div>` : ''}
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
          <span>💰 القسم الرابع — البيانات الاقتصادية والمالية</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <div class="pdf-section-subtitle" style="margin-top: 0;">مصادر الدخل الشهري</div>
            ${incomeItems.length > 0 ? `
              <table class="pdf-table">
                <thead>
                  <tr>
                    <th>البند / المصدر</th>
                    <th style="width: 30%;">المبلغ</th>
                    <th style="width: 22%;">الدورية</th>
                  </tr>
                </thead>
                <tbody>
                  ${incomeItems.map(i => `
                    <tr>
                      <td>${DOM.escapeHTML(val(i.label))} ${i.source ? `<span style="font-size: 8.5px; color: #64748b;">(${DOM.escapeHTML(i.source)})</span>` : ''}</td>
                      <td style="color: #047857; font-weight: 700;">${money(i.amount)}</td>
                      <td>${DOM.escapeHTML(val(i.period))}</td>
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
                    <th style="width: 30%;">المبلغ</th>
                    <th style="width: 22%;">الدورية</th>
                  </tr>
                </thead>
                <tbody>
                  ${expenseItems.map(e => `
                    <tr>
                      <td>${DOM.escapeHTML(val(e.label))}</td>
                      <td style="color: #be123c; font-weight: 700;">${money(e.amount)}</td>
                      <td>${DOM.escapeHTML(val(e.period))}</td>
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

  /* ---- Section: الاحتياجات المقيَّمة (القسم الخامس) ---- */
  const needs = Array.isArray(c.assessedNeeds) ? c.assessedNeeds : [];
  if (needs.length > 0) {
    sections.push({
      id: 'assessed-needs',
      html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>📌 القسم الخامس — الاحتياجات المقيَّمة</span>
          <span class="pdf-badge pdf-badge--neutral">${needs.length} احتياج</span>
        </div>
        <div class="pdf-chips-list">
          ${needs.map(n => `<span class="pdf-chip pdf-chip--active">✓ ${DOM.escapeHTML(val(n.needType))}</span>`).join('')}
        </div>
      </div>
    `
    });
  }

  sections.push({
    id: 'assessment-opinions',
    html: `
      <div class="pdf-section">
        <div class="pdf-section-title">
          <span>📋 القسم السادس — التقييم والبحث الاجتماعي والتوصيات</span>
        </div>

        ${hasOpinion(workerOp) ? `
          <div class="pdf-section-subtitle" style="display: flex; justify-content: space-between;">
            <span>رأي وتقرير الأخصائي الاجتماعي الميداني:</span>
            <span class="pdf-badge pdf-badge--info">${decisionHtml(workerOp.decision)}</span>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.6; color: #1e293b;">
            "${DOM.escapeHTML(val(workerOp.notes, 'لا توجد ملاحظات تفصيلية'))}"
          </div>
          ${workerOp.author && !workerOp.isLegacyImport ? `
            <div style="font-size: 10px; color: #64748b; margin-top: 3px; font-weight: 700;">
              الأخصائي: ${DOM.escapeHTML(workerOp.author)} ${workerOp.date ? `(${formatDate(workerOp.date)})` : ''}
            </div>
          ` : ''}
        ` : `
          <div class="pdf-section-subtitle">رأي وتقرير الأخصائي الاجتماعي الميداني:</div>
          <div class="pdf-opinion pdf-opinion--empty"><span class="pdf-opinion__empty-text">لا يوجد رأي مسجل من الأخصائي بعد</span></div>
        `}

        ${supportTypes.length > 0 ? `
          <div class="pdf-section-subtitle" style="margin-top: 8px;">أنواع الدعم المقترحة من الأخصائي:</div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th>نوع الدعم المقترح</th>
                <th>الفئة / الكمية</th>
                <th>المستفيدون</th>
              </tr>
            </thead>
            <tbody>
              ${supportTypes.map(s => `
                <tr>
                  <td><strong>${DOM.escapeHTML(val(s.title))}</strong></td>
                  <td>${DOM.escapeHTML(val(s.option))}</td>
                  <td>${DOM.escapeHTML(Array.isArray(s.recipients) && s.recipients.length ? s.recipients.join('، ') : '—')}</td>
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

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          ${opinionCardHtml(reviewerOp, { title: 'قرار وتوصية المراجع', color: '#1d4ed8', roleLabel: 'المراجع', emptyText: 'لا يوجد رأي مسجل من المراجع بعد' })}
          ${opinionCardHtml(managerOp, { title: 'الاعتماد النهائي للمدير', color: '#047857', roleLabel: 'المدير', emptyText: 'لا يوجد اعتماد مسجل من المدير بعد' })}
        </div>
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
                  <td>${DOM.escapeHTML(val(documentTypeLabel(a.docType || a.documentType)))}</td>
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

  /* ---- Section 9: الدعم المصروف فعليًا (تُعرض فقط إن وُجدت) ---- */
  const supportHistory = Array.isArray(sup.history) ? sup.history : [];
  if (supportHistory.length > 0) {
    sections.push({
      id: 'support-history',
      html: `
        <div class="pdf-section">
          <div class="pdf-section-title">
            <span>📦 القسم التاسع — الدعم المصروف فعليًا</span>
            <span class="pdf-badge pdf-badge--neutral">${supportHistory.length} عملية صرف</span>
          </div>
          <table class="pdf-table">
            <thead>
              <tr>
                <th>نوع الدعم</th>
                <th style="width: 20%;">الكمية</th>
                <th style="width: 30%;">المستلم</th>
                <th style="width: 20%;">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              ${supportHistory.map(hst => `
                <tr>
                  <td><strong>${DOM.escapeHTML(val(hst.supportType))}</strong></td>
                  <td>${DOM.escapeHTML(val(hst.quantity))}</td>
                  <td>${DOM.escapeHTML(val(hst.recipientName))}</td>
                  <td>${formatDate(hst.date)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `
    });
  }

  /* ---- Section 10: اعتماد وتوقيعات ---- */
  sections.push({
    id: 'signatures',
    html: `
      <div class="pdf-section pdf-signatures">
        <div class="pdf-section-title">
          <span>✍️ الاعتماد والتوقيعات</span>
        </div>
        <div class="pdf-signatures-grid">
          <div class="pdf-signature-box">
            <span class="pdf-signature-box__role">أخصائي التنمية</span>
            <span class="pdf-signature-box__line"></span>
            <span class="pdf-signature-box__caption">التوقيع</span>
          </div>
          <div class="pdf-signature-box">
            <span class="pdf-signature-box__role">المراجع</span>
            <span class="pdf-signature-box__line"></span>
            <span class="pdf-signature-box__caption">التوقيع</span>
          </div>
          <div class="pdf-signature-box">
            <span class="pdf-signature-box__role">مدير التنمية</span>
            <span class="pdf-signature-box__line"></span>
            <span class="pdf-signature-box__caption">التوقيع</span>
          </div>
        </div>
      </div>
    `
  });

  return sections;
}

/**
 * Intelligent section packer:
 * Measures actual rendered height of each section card and allocates cards
 * into pages to guarantee no mid-section cuts and consistent headers/footers.
 */
function packSectionsIntoPages(sections, headerHeight = 100, footerHeight = 40) {
  // A4 = 1123px height. Padding = 44px. Header = 136px (شعار 84px). Footer = 40px.
  // Net safe page budget:
  const PAGE_CAPACITY = 845;

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

    // Wait for every logo/image inside the stage to actually finish loading
    // (or fail) before html2canvas snapshots it — otherwise fast exports can
    // capture the header/footer logos mid-load as blank space.
    const images = [...stage.querySelectorAll('img')];
    await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));

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
