/**
 * الإعدادات العامة للتطبيق.
 * لا تضع هنا أي كلمة مرور أو سر. معرّفات Drive وSheets والسر العام
 * تُحفظ في Script Properties بواسطة دالة setup().
 */

const APP_NAME = 'أمن و سلامة';
const ROOT_FOLDER_NAME = 'أمن و سلامة - أرشيف العكر';
const SYSTEM_FOLDER_NAME = '_System';
const SPREADSHEET_NAME = 'أمن و سلامة - قاعدة البيانات';

/** أنواع السجلات. restricted = صورها لا تُعرض إلا للإدارة. */
const RECORD_TYPES = {
  IN: { label: 'بضاعة داخلة', folder: 'Incoming Goods', restricted: false },
  OUT: { label: 'بضاعة خارجة', folder: 'Outgoing Goods', restricted: false },
  INC: { label: 'مخالفات العمال', folder: 'Employee Incidents', restricted: true }
};

const SESSION_HOURS_SHORT = 12;      // جلسة بدون «تذكّرني»
const SESSION_DAYS_REMEMBER = 14;    // جلسة مع «تذكّرني»
const SESSION_CACHE_SECONDS = 120;   // تخزين مؤقت لبيانات الجلسة
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const HASH_ITERATIONS = 500;
const MIN_PASSWORD_LENGTH = 6;

const MAX_IMAGES_PER_RECORD = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const PENDING_FILE_TTL_HOURS = 48;   // صور رُفعت ولم يكتمل سجلها

const ACCESS_LEVELS = { admin: 'إدارة', user: 'مستخدم' };

const PAGE_SIZE = 30;
const TODAY_SCAN_ROWS = 400;         // عدد الصفوف الأخيرة التي تُفحص لقائمة «سجلاتي اليوم»
const DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss';

/** أعمدة كل ورقة بالترتيب. كل القيم تُحفظ كنص. */
const SCHEMA = {
  Records: ['record_id', 'type', 'event_at', 'created_at', 'created_by', 'supplier', 'branch',
    'person_name', 'doc_number', 'description', 'notes', 'file_ids', 'file_count', 'status',
    'updated_at', 'updated_by', 'request_id', 'created_by_role'],
  Files: ['file_key', 'request_id', 'record_id', 'image_index', 'drive_file_id', 'file_name',
    'mime_type', 'size_bytes', 'uploaded_at', 'uploaded_by', 'status'],
  Branches: ['branch_id', 'name', 'active', 'sort_order'],
  Roles: ['role_id', 'name', 'can_create', 'is_admin', 'notes'],
  // role = الوظيفة (حارس، سلامة الغذاء...)، access = الصلاحية (admin إدارة / user مستخدم)
  Users: ['username', 'display_name', 'role', 'password_hash', 'salt', 'active', 'must_change',
    'failed_attempts', 'locked_until', 'created_at', 'last_login_at', 'access'],
  Sessions: ['token_hash', 'username', 'created_at', 'expires_at', 'remember', 'device_hint'],
  Counters: ['type', 'year', 'last_seq'],
  AuditLog: ['at', 'username', 'action', 'record_id', 'details']
};
