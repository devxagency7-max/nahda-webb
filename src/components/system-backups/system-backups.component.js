/* --------------------------------------------------------------------------
   SYSTEM BACKUPS (المدير بس)
   - صفحة «النسخ الاحتياطية»: حالة آخر نسخة + تحميل + سجل + إنشاء نسخة الآن +
     تصدير Excel فوري.
   - تنبيه أحمر في الرئيسية والشريط الجانبي طول ما نسخة جاهزة ومحدش من المديرين
     نزّلها (GET /system-backups/status -> downloadRequired).
   تحميل النسخة = POST /system-backups/{id}/download بيرجّع رابط صالح ساعتين؛
   بنفتحه فورًا ومابنخزنوش، وبعدها بنعيد قراءة الحالة عشان التنبيه يقفل.
   -------------------------------------------------------------------------- */
import { DOM } from '../../utils/dom.js';
import { showToast } from '../../utils/toast.js';
import { confirmDialog } from '../../utils/dialog.js';
import { formatCairoDateTime } from '../../utils/date.js';
import { messageFromError } from '../../services/errors.js';
import { SystemBackupsService } from '../../services/system-backups.service.js';
import { TokenStore } from '../../services/tokens.js';
import { EventBus, EVENTS } from '../../core/event-bus.js';
import { onViewEnter } from '../../core/view-lifecycle.js';
import { can, PERMISSIONS } from '../../core/permissions.js';
import { switchView } from '../../core/router.js';

const STATUS_LABELS = { building: 'جاري الإنشاء', ready: 'جاهزة', failed: 'فشلت' };

let busy = false;

function canManageBackups() {
  return TokenStore.hasSession() && can(PERMISSIONS.DOWNLOAD_SYSTEM_BACKUP);
}

function sizeLabel(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} ميجا` : `${Math.max(1, Math.round(n / 1024))} كيلو`;
}

/* ---------------------------- التنبيه الأحمر ---------------------------- */

function setAlert(active, latest) {
  DOM.qsa('[data-backup-alert-dot]').forEach(el => { el.hidden = !active; });
  const banner = DOM.qs('#backup-alert-banner');
  if (!banner) return;
  banner.hidden = !active;
  const text = DOM.qs('#backup-alert-text');
  if (text && active) {
    text.textContent = latest?.period
      ? `النسخة الاحتياطية الشهرية (${latest.period}) جاهزة ولسه ماتحمّلتش — لازم تتحمّل.`
      : 'فيه نسخة احتياطية شهرية جاهزة ولسه ماتحمّلتش — لازم تتحمّل.';
  }
}

/** يقرا حالة النسخة ويحدّث التنبيه. لأي دور غير المدير: مفيش طلب أصلًا. */
export async function refreshBackupAlert() {
  // زرار النسخة الاحتياطية في الـ navbar: ظاهر للمدير في أي وقت.
  DOM.qsa('[data-backup-nav]').forEach(el => { el.hidden = !canManageBackups(); });
  if (!canManageBackups()) {
    setAlert(false);
    return null;
  }
  try {
    const status = await SystemBackupsService.status();
    setAlert(Boolean(status?.downloadRequired && status?.latest), status?.latest);
    return status;
  } catch (err) {
    console.error('[system-backups] status failed:', err);
    return null;
  }
}

/* ---------------------------- الصفحة ---------------------------- */

function renderStatus(status) {
  const host = DOM.qs('#sb-status');
  if (!host) return;
  const latest = status?.latest;
  if (!latest) {
    host.innerHTML = '<p class="case-page-empty">لسه مفيش نسخة جاهزة — أول نسخة بتتجهز تلقائي أول كل شهر.</p>';
    return;
  }
  const pending = Boolean(status.downloadRequired);
  const missing = Number(latest.missingAttachmentCount) || 0;
  host.innerHTML = `
    <div class="sb-latest ${pending ? 'sb-latest--pending' : ''}">
      <div class="sb-latest__head">
        <div>
          <div class="sb-latest__title">${pending ? '⚠️ نسخة ماتحمّلتش' : '✅ آخر نسخة'} — شهر ${DOM.escapeHTML(latest.period || '—')}</div>
          <div class="sb-latest__meta">
            ${DOM.escapeHTML(STATUS_LABELS[latest.status] || latest.status || '')}
            · ${DOM.escapeHTML(sizeLabel(latest.sizeBytes))}
            · ${Number(latest.caseCount) || 0} حالة
            · ${Number(latest.attachmentCount) || 0} مرفق
            ${missing ? `· <span class="sb-warn">${missing} مرفق مفقود</span>` : ''}
          </div>
          <div class="sb-latest__meta">
            ${latest.downloadedAtUtc
              ? `اتحمّلت ${DOM.escapeHTML(formatCairoDateTime(latest.downloadedAtUtc))}`
              : 'لسه ماتحمّلتش'}
          </div>
        </div>
        ${latest.status === 'ready' ? `<button type="button" class="btn btn--primary" data-sb-download="${DOM.escapeHTML(latest.id)}">تحميل النسخة الاحتياطية</button>` : ''}
      </div>
    </div>`;
}

function renderHistory(items) {
  const host = DOM.qs('#sb-history');
  if (!host) return;
  if (!items.length) {
    host.innerHTML = '<p class="case-page-empty">مفيش نسخ سابقة.</p>';
    return;
  }
  host.innerHTML = `
    <div class="sb-table-wrap">
      <table class="sb-table">
        <thead><tr><th>الشهر</th><th>الحالة</th><th>الحجم</th><th>الحالات</th><th>المرفقات</th><th>اتحمّلت</th><th></th></tr></thead>
        <tbody>
          ${items.map(b => `
            <tr>
              <td>${DOM.escapeHTML(b.period || '—')}</td>
              <td>${DOM.escapeHTML(STATUS_LABELS[b.status] || b.status || '')}</td>
              <td>${DOM.escapeHTML(sizeLabel(b.sizeBytes))}</td>
              <td>${Number(b.caseCount) || 0}</td>
              <td>${Number(b.attachmentCount) || 0}${Number(b.missingAttachmentCount) ? ` <span class="sb-warn">(${Number(b.missingAttachmentCount)} مفقود)</span>` : ''}</td>
              <td>${b.downloadedAtUtc ? DOM.escapeHTML(formatCairoDateTime(b.downloadedAtUtc)) : '—'}</td>
              <td>${b.status === 'ready' ? `<button type="button" class="btn btn--secondary" data-sb-download="${DOM.escapeHTML(b.id)}">تحميل</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadPage() {
  if (!canManageBackups()) return;
  try {
    const [status, items] = await Promise.all([SystemBackupsService.status(), SystemBackupsService.list()]);
    renderStatus(status);
    renderHistory(items);
    setAlert(Boolean(status?.downloadRequired && status?.latest), status?.latest);
  } catch (err) {
    showToast(messageFromError(err), 'error');
  }
}

async function withBusy(button, task) {
  if (busy) return;
  busy = true;
  button?.setAttribute('disabled', 'disabled');
  try {
    await task();
  } catch (err) {
    showToast(messageFromError(err), 'error');
  } finally {
    busy = false;
    button?.removeAttribute('disabled');
  }
}

async function downloadBackup(id, button) {
  await withBusy(button, async () => {
    // الرابط صالح ساعتين بس ومابيتخزنش — كل تحميل بيطلب رابط جديد.
    const res = await SystemBackupsService.download(id);
    const link = document.createElement('a');
    link.href = res.downloadUrl;
    link.download = res.fileName || '';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('بدأ تحميل النسخة الاحتياطية 📦', 'success');
    // مجرد النداء علّم النسخة «اتحملت» لكل المديرين — نعيد القراءة عشان التنبيه يقفل.
    await loadPage();
  });
}

async function rebuild(button) {
  const ok = await confirmDialog({
    title: 'إنشاء نسخة الآن',
    message: 'هيتعاد إنشاء نسخة الشهر الحالي، وده ممكن ياخد كذا دقيقة. بعدها النسخة بتبقى «لسه ماتحمّلتش» تاني. تكمّل؟',
    confirmLabel: 'إنشاء النسخة'
  });
  if (!ok) return;
  await withBusy(button, async () => {
    showToast('جاري إنشاء النسخة… ممكن ياخد كذا دقيقة، ماتقفلش الصفحة', 'info', 6000);
    await SystemBackupsService.rebuild();
    showToast('النسخة الاحتياطية اتجهزت ✅', 'success');
    await loadPage();
  });
}

async function exportXlsx(button) {
  await withBusy(button, async () => {
    showToast('جاري تجهيز ملف Excel… ممكن ياخد دقيقة', 'info', 5000);
    await SystemBackupsService.exportCasesXlsx();
    showToast('تم تنزيل ملف Excel ✅', 'success');
  });
}

/** يفتح صفحة النسخ الاحتياطية (من الإشعار أو من التنبيه الأحمر). */
export function openSystemBackupsPage() {
  switchView('system-backups');
}

export function initSystemBackups() {
  const view = DOM.qs('#view-system-backups');

  view?.addEventListener('click', (e) => {
    const dl = e.target.closest('[data-sb-download]');
    if (dl) {
      downloadBackup(dl.dataset.sbDownload, dl);
      return;
    }
    const rebuildBtn = e.target.closest('#sb-rebuild');
    if (rebuildBtn) {
      rebuild(rebuildBtn);
      return;
    }
    const exportBtn = e.target.closest('#sb-export-xlsx');
    if (exportBtn) exportXlsx(exportBtn);
  });

  DOM.qs('#backup-alert-open')?.addEventListener('click', openSystemBackupsPage);
  DOM.qsa('[data-backup-nav]').forEach(btn => btn.addEventListener('click', openSystemBackupsPage));

  onViewEnter('system-backups', loadPage);
  // بنفحص الحالة بعد تسجيل الدخول/تغيير المستخدم وكل ما المدير يرجع للرئيسية.
  onViewEnter('dashboard', refreshBackupAlert);
  EventBus.on(EVENTS.USER_CHANGED, refreshBackupAlert);
  window.openSystemBackupsPage = openSystemBackupsPage;
  window.refreshBackupAlert = refreshBackupAlert;
}
