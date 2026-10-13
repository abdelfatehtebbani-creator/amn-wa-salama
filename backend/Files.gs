/**
 * حفظ الصور في Google Drive وقراءتها.
 * كل الملفات خاصة بحساب المالك ولا تُشارك مع أحد؛ المستخدمون يرون الصور
 * فقط عبر الخادم بعد فحص الصلاحية.
 */

function typeFolder_(type) {
  return DriveApp.getFolderById(prop_('FOLDER_' + type));
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** المجلد: نوع السجل / السنة / الشهر */
function monthFolder_(type, date) {
  const year = Utilities.formatDate(date, tz_(), 'yyyy');
  const month = Utilities.formatDate(date, tz_(), 'MM');
  return childFolder_(childFolder_(typeFolder_(type), year), month);
}

function validRequestId_(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    throw appError_('INVALID', 'معرّف الطلب غير صالح.');
  }
  return id;
}

function requireCanCreate_(ctx, type) {
  if (!RECORD_TYPES[type]) throw appError_('INVALID', 'نوع السجل غير معروف.');
  if (ctx.can_create.indexOf(type) < 0) throw appError_('FORBIDDEN', 'ليست لديك صلاحية إنشاء هذا النوع من السجلات.');
}

function extFor_(mime) {
  return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
}

/**
 * يرفع صورة واحدة. آمن لإعادة المحاولة: نفس (request_id, index) لا يُنشئ ملفًا ثانيًا.
 */
function uploadImage_(ctx, p) {
  const requestId = validRequestId_(p.request_id);
  const index = Math.floor(num_(p.index));
  if (index < 1 || index > 100) throw appError_('INVALID', 'رقم الصورة غير صالح.');
  requireCanCreate_(ctx, p.type);
  if (ALLOWED_MIME.indexOf(p.mime) < 0) throw appError_('INVALID', 'صيغة الصورة غير مدعومة.');

  const fileKey = requestId + '#' + index;
  const existing = findOne_('Files', 'file_key', fileKey);
  if (existing && existing.status !== 'deleted') {
    if (existing.uploaded_by !== ctx.username) throw appError_('FORBIDDEN', 'لا يمكن استخدام هذا الطلب.');
    return { file_key: fileKey, index: index, duplicate: true };
  }

  const pendingCount = findAll_('Files', 'request_id', requestId).filter(f => f.status !== 'deleted').length;
  if (pendingCount >= MAX_IMAGES_PER_RECORD * 2) {
    throw appError_('INVALID', 'الحد الأقصى ' + MAX_IMAGES_PER_RECORD + ' صور للسجل الواحد.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(String(p.data || ''));
  } catch (e) {
    throw appError_('INVALID', 'بيانات الصورة تالفة. أعد المحاولة.');
  }
  if (!bytes.length) throw appError_('INVALID', 'الصورة فارغة.');
  if (bytes.length > MAX_IMAGE_BYTES) throw appError_('INVALID', 'حجم الصورة كبير جدًا.');

  const now = new Date();
  const name = 'pending_' + requestId + '_' + ('0' + index).slice(-2) + '.' + extFor_(p.mime);
  const file = monthFolder_(p.type, now).createFile(Utilities.newBlob(bytes, p.mime, name));

  appendObj_('Files', {
    file_key: fileKey, request_id: requestId, record_id: '', image_index: index,
    drive_file_id: file.getId(), file_name: name, mime_type: p.mime, size_bytes: bytes.length,
    uploaded_at: fmtDate_(now), uploaded_by: ctx.username, status: 'pending'
  });
  return { file_key: fileKey, index: index, duplicate: false };
}

/** يعيد الصورة بصيغة base64 للإدارة فقط، وفقط لملفات مرتبطة بسجل. */
function getImage_(ctx, p) {
  const fileId = text_(p.drive_file_id, 100);
  const meta = findOne_('Files', 'drive_file_id', fileId);
  if (!meta || meta.status !== 'attached') throw appError_('NOT_FOUND', 'الصورة غير موجودة.');
  const record = findOne_('Records', 'record_id', meta.record_id);
  if (!record) throw appError_('NOT_FOUND', 'السجل غير موجود.');
  if (RECORD_TYPES[record.type] && RECORD_TYPES[record.type].restricted) {
    audit_(ctx.username, 'view_restricted_image', record.record_id, { index: meta.image_index });
  }
  const blob = DriveApp.getFileById(fileId).getBlob();
  return {
    name: meta.file_name, mime: meta.mime_type,
    data: Utilities.base64Encode(blob.getBytes())
  };
}
