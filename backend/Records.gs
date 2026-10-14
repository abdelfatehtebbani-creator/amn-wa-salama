/**
 * إنشاء السجلات والبحث فيها وتعديلها.
 */

/** الحقول النصية القابلة للإدخال وحدودها. */
const FIELD_LIMITS = {
  supplier: 120, branch: 120, person_name: 120, doc_number: 60, description: 500, notes: 1000, invoice_source: 20
};

/** الحقول المستخدمة في كل نوع. */
const TYPE_FIELDS = {
  IN: ['invoice_source', 'supplier', 'doc_number', 'description', 'notes'],
  OUT: ['invoice_source', 'branch', 'doc_number', 'description', 'notes'],
  INC: ['person_name', 'description', 'notes']
};

function nextRecordId_(type, date) {
  const year = Utilities.formatDate(date, tz_(), 'yyyy');
  const counter = readAll_('Counters').filter(c => c.type === type && c.year === year)[0];
  let seq;
  if (counter) {
    seq = num_(counter.last_seq) + 1;
    updateObj_('Counters', counter._row, { last_seq: seq });
  } else {
    seq = 1;
    appendObj_('Counters', { type: type, year: year, last_seq: seq });
  }
  return type + '-' + year + '-' + ('0000' + seq).slice(-5);
}

function activeBranchNames_() {
  return readAll_('Branches').filter(b => bool_(b.active)).map(b => b.name);
}

/** يقرأ الحقول المسموح بها للنوع ويتحقق من الإلزامي منها. */
function cleanFields_(type, input) {
  const out = {};
  TYPE_FIELDS[type].forEach(f => { out[f] = text_(input[f], FIELD_LIMITS[f]); });
  checkInvoiceSource_(type, out);
  if (type === 'OUT') {
    if (!out.branch) throw appError_('INVALID', 'اختر الفرع المستلم.');
    if (activeBranchNames_().indexOf(out.branch) < 0) throw appError_('INVALID', 'الفرع غير موجود في القائمة.');
  }
  if (type === 'INC' && !out.description) throw appError_('INVALID', 'اكتب وصفًا مختصرًا للواقعة.');
  return out;
}

function checkInvoiceSource_(type, fields) {
  if ((type === 'IN' || type === 'OUT') && !INVOICE_SOURCES[fields.invoice_source]) {
    throw appError_('INVALID', 'اختر نوع الفاتورة: فواتير العكر أو فواتير موردين.');
  }
}

function eventDate_(input) {
  if (!input) return new Date();
  const d = parseLocalInput_(input);
  if (!d) throw appError_('INVALID', 'صيغة التاريخ غير صحيحة.');
  if (d.getTime() > Date.now() + 86400000) throw appError_('INVALID', 'التاريخ في المستقبل.');
  return d;
}

/** شكل السجل الذي يُرسل للواجهة. */
function publicRecord_(r) {
  return {
    record_id: r.record_id, type: r.type, type_label: (RECORD_TYPES[r.type] || {}).label || r.type,
    event_at: r.event_at, created_at: r.created_at, created_by: r.created_by, created_by_role: r.created_by_role,
    invoice_source: r.invoice_source || '', supplier: r.supplier, branch: r.branch, person_name: r.person_name, doc_number: r.doc_number,
    description: r.description, notes: r.notes, file_count: num_(r.file_count), status: r.status,
    updated_at: r.updated_at, updated_by: r.updated_by
  };
}

/**
 * ينشئ السجل بعد رفع كل صوره. آمن لإعادة المحاولة بنفس request_id.
 * p: { request_id, type, event_at, fields: {...}, image_indexes: [1,2,...] }
 */
function createRecord_(ctx, p) {
  const requestId = validRequestId_(p.request_id);
  requireCanCreate_(ctx, p.type);

  const existing = findOne_('Records', 'request_id', requestId);
  if (existing) {
    if (existing.created_by !== ctx.username) throw appError_('FORBIDDEN', 'لا يمكن استخدام هذا الطلب.');
    return { record: publicRecord_(existing), duplicate: true };
  }

  const fields = cleanFields_(p.type, p.fields || {});
  const eventAt = eventDate_(p.event_at);

  const wanted = (Array.isArray(p.image_indexes) ? p.image_indexes : []).map(n => Math.floor(num_(n)));
  if (!wanted.length) throw appError_('INVALID', 'أرفق صورة واحدة على الأقل.');
  if (wanted.length > MAX_IMAGES_PER_RECORD) throw appError_('INVALID', 'عدد الصور أكبر من المسموح.');

  const files = findAll_('Files', 'request_id', requestId)
    .filter(f => f.status !== 'deleted' && f.uploaded_by === ctx.username);
  const byIndex = {};
  files.forEach(f => { byIndex[num_(f.image_index)] = f; });
  const missing = wanted.filter(i => !byIndex[i]);
  if (missing.length) {
    throw appError_('IMAGES_MISSING', 'بعض الصور لم تصل إلى الخادم. أعد المحاولة.', { missing: missing });
  }

  // إن انقطع تنفيذ سابق بعد ربط الصور، نعيد استخدام نفس الرقم.
  const chosen = wanted.slice().sort((a, b) => a - b).map(i => byIndex[i]);
  const recordId = (chosen.filter(f => f.record_id)[0] || {}).record_id || nextRecordId_(p.type, new Date());

  chosen.forEach((f, i) => {
    const name = recordId + '_' + ('0' + (i + 1)).slice(-2) + '.' + extFor_(f.mime_type);
    if (f.file_name !== name) DriveApp.getFileById(f.drive_file_id).setName(name);
    updateObj_('Files', f._row, { record_id: recordId, status: 'attached', file_name: name });
  });

  const now = nowStr_();
  const record = Object.assign({
    record_id: recordId, type: p.type, event_at: fmtDate_(eventAt), created_at: now,
    created_by: ctx.username, file_ids: chosen.map(f => f.drive_file_id).join(','),
    file_count: chosen.length, status: 'active', updated_at: '', updated_by: '', request_id: requestId,
    created_by_role: ctx.function_name || ctx.access_name
  }, fields);
  appendObj_('Records', record);
  audit_(ctx.username, 'create', recordId, { files: chosen.length });
  return { record: publicRecord_(record), duplicate: false };
}

/** سجلات المستخدم التي أنشأها اليوم (للتأكد من الحفظ). */
function myToday_(ctx) {
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const rows = readLast_('Records', TODAY_SCAN_ROWS)
    .filter(r => r.created_by === ctx.username && r.created_at.slice(0, 10) === today && r.status === 'active')
    .reverse();
  return { records: rows.map(publicRecord_) };
}

/**
 * بحث الأرشيف (الإدارة فقط).
 * p: { q, type, invoice_source, from: 'yyyy-MM-dd', to: 'yyyy-MM-dd', include_deleted, page }
 */
function searchRecords_(ctx, p) {
  const q = text_(p.q, 100).toLowerCase();
  const type = RECORD_TYPES[p.type] ? p.type : '';
  const source = INVOICE_SOURCES[p.invoice_source] ? p.invoice_source : '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.from || '') ? p.from : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.to || '') ? p.to : '';
  const page = Math.max(1, Math.floor(num_(p.page) || 1));

  const results = readAll_('Records').filter(r => {
    if (!p.include_deleted && r.status !== 'active') return false;
    if (type && r.type !== type) return false;
    if (source && r.invoice_source !== source) return false;
    const day = r.event_at.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q) {
      const hay = [r.record_id, r.doc_number, r.supplier, r.branch, r.person_name, r.description]
        .join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  results.sort((a, b) => (b.event_at + b.created_at).localeCompare(a.event_at + a.created_at));

  const start = (page - 1) * PAGE_SIZE;
  return {
    total: results.length, page: page, page_size: PAGE_SIZE,
    records: results.slice(start, start + PAGE_SIZE).map(publicRecord_)
  };
}

function getRecordOrThrow_(recordId) {
  const record = findOne_('Records', 'record_id', text_(recordId, 30));
  if (!record) throw appError_('NOT_FOUND', 'السجل غير موجود.');
  return record;
}

function getRecord_(ctx, p) {
  const record = getRecordOrThrow_(p.record_id);
  const files = findAll_('Files', 'record_id', record.record_id)
    .filter(f => f.status === 'attached')
    .sort((a, b) => num_(a.image_index) - num_(b.image_index))
    .map(f => ({ drive_file_id: f.drive_file_id, index: num_(f.image_index), name: f.file_name }));
  return { record: publicRecord_(record), files: files, branches: activeBranchNames_() };
}

function updateRecord_(ctx, p) {
  const record = getRecordOrThrow_(p.record_id);
  const input = Object.assign({}, record, p.fields || {});
  const fields = cleanFieldsForEdit_(record, input);
  if (p.event_at) fields.event_at = fmtDate_(eventDate_(p.event_at));

  const changes = {};
  Object.keys(fields).forEach(k => { if (fields[k] !== record[k]) changes[k] = { from: record[k], to: fields[k] }; });
  if (!Object.keys(changes).length) return { record: publicRecord_(record) };

  const updated = updateObj_('Records', record._row, Object.assign(fields, { updated_at: nowStr_(), updated_by: ctx.username }));
  audit_(ctx.username, 'edit', record.record_id, changes);
  return { record: publicRecord_(updated) };
}

/** عند التعديل نسمح بإبقاء فرع قديم حتى لو أُوقف لاحقًا. */
function cleanFieldsForEdit_(record, input) {
  if (record.type === 'OUT' && input.branch === record.branch) {
    const out = {};
    TYPE_FIELDS.OUT.forEach(f => { out[f] = text_(input[f], FIELD_LIMITS[f]); });
    checkInvoiceSource_('OUT', out);
    return out;
  }
  return cleanFields_(record.type, input);
}

function setRecordStatus_(ctx, p, status) {
  const record = getRecordOrThrow_(p.record_id);
  if (record.status === status) return { record: publicRecord_(record) };
  const updated = updateObj_('Records', record._row, { status: status, updated_at: nowStr_(), updated_by: ctx.username });
  audit_(ctx.username, status === 'deleted' ? 'delete' : 'restore', record.record_id, null);
  return { record: publicRecord_(updated) };
}

/** أسماء موردين سابقة للاقتراح التلقائي. */
function supplierSuggestions_(ctx) {
  const seen = {};
  readLast_('Records', 1000).forEach(r => {
    if (r.type === 'IN' && r.supplier) seen[r.supplier] = true;
  });
  return { suppliers: Object.keys(seen).sort().slice(0, 300) };
}
