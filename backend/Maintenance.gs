/**
 * تنظيف يومي يُشغَّل تلقائيًا بواسطة مشغّل زمني تنشئه setup().
 * - يحذف الجلسات المنتهية.
 * - ينقل إلى سلة المهملات الصور التي رُفعت ولم يكتمل سجلها خلال 48 ساعة.
 */
function dailyCleanup() {
  withLock_(() => {
    const now = nowStr_();
    const expired = readAll_('Sessions').filter(s => s.expires_at <= now);
    deleteRows_('Sessions', expired.map(s => s._row));

    const cutoff = fmtDate_(new Date(Date.now() - PENDING_FILE_TTL_HOURS * 3600000));
    const stale = readAll_('Files').filter(f => f.status === 'pending' && f.uploaded_at < cutoff);
    stale.forEach(f => {
      try {
        DriveApp.getFileById(f.drive_file_id).setTrashed(true);
      } catch (e) {
        console.warn('تعذر حذف الملف ' + f.drive_file_id + ': ' + e);
      }
      updateObj_('Files', f._row, { status: 'deleted' });
    });

    if (expired.length || stale.length) {
      audit_('system', 'cleanup', '', { sessions: expired.length, files: stale.length });
    }
  });
}
