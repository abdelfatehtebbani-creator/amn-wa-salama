// محاكاة مبسطة لخدمات Google Apps Script لتشغيل كود backend/ محليًا في Node.
// للاختبار فقط: لا تُستخدم في التشغيل الحقيقي.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const TZ_OFFSET_MIN = 60; // Africa/Algiers = UTC+1 دون توقيت صيفي

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function formatDate(date, tz, fmt) {
  const d = new Date(date.getTime() + TZ_OFFSET_MIN * 60000);
  const map = {
    yyyy: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds())
  };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
}

function parseDate(str, tz, fmt) {
  if (fmt !== 'yyyy-MM-dd HH:mm:ss') throw new Error('mock parseDate: unsupported format ' + fmt);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(str);
  if (!m) throw new Error('Unparseable date: ' + str);
  return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - TZ_OFFSET_MIN * 60000);
}

const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = arr => Buffer.from(arr.map(b => (b + 256) % 256));

function createEnv() {
  let idSeq = 0;
  const newId = p => p + '_' + (++idSeq) + '_' + crypto.randomBytes(4).toString('hex');
  const spreadsheets = {};
  const folders = {};
  const files = {};
  const props = {};
  const cache = {};
  const logs = [];

  // ---------- Sheets ----------
  function makeSheet(name) {
    const data = []; // مصفوفة صفوف من النصوص
    let maxRows = 1000;
    const sheet = {
      _data: data,
      getName: () => name,
      getLastRow: () => {
        for (let r = data.length - 1; r >= 0; r--) if ((data[r] || []).some(v => v !== '' && v != null)) return r + 1;
        return 0;
      },
      getMaxRows: () => maxRows,
      insertRowsAfter: (after, n) => { maxRows += n; },
      deleteRow: r => { data.splice(r - 1, 1); maxRows--; },
      setFrozenRows: () => sheet,
      setRightToLeft: () => sheet,
      getRange: (row, col, nr = 1, nc = 1) => {
        if (row + nr - 1 > maxRows) throw new Error('Range out of bounds');
        const range = {
          getRow: () => row,
          getValues: () => {
            const out = [];
            for (let r = 0; r < nr; r++) {
              const line = [];
              for (let c = 0; c < nc; c++) line.push((data[row - 1 + r] || [])[col - 1 + c] ?? '');
              out.push(line);
            }
            return out;
          },
          setValues: values => {
            if (values.length !== nr || values[0].length !== nc) throw new Error('setValues dimension mismatch');
            for (let r = 0; r < nr; r++) {
              data[row - 1 + r] = data[row - 1 + r] || [];
              for (let c = 0; c < nc; c++) {
                let v = values[r][c];
                if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
                else if (typeof v === 'string' && v.startsWith('=')) throw new Error('Formula written: ' + v);
                data[row - 1 + r][col - 1 + c] = v;
              }
            }
            return range;
          },
          setValue: v => range.setValues([[v]]),
          setNumberFormat: () => range,
          setFontWeight: () => range,
          setBackground: () => range,
          createTextFinder: text => {
            const finder = {
              matchEntireCell: () => finder,
              matchCase: () => finder,
              findAll: () => {
                const cells = [];
                for (let r = 0; r < nr; r++) {
                  for (let c = 0; c < nc; c++) {
                    const v = (data[row - 1 + r] || [])[col - 1 + c];
                    if (v !== undefined && String(v) === text) cells.push({ getRow: () => row + r });
                  }
                }
                return cells;
              },
              findNext: () => finder.findAll()[0] || null
            };
            return finder;
          }
        };
        return range;
      }
    };
    return sheet;
  }

  function makeSpreadsheet(name) {
    const id = newId('ss');
    const sheets = [makeSheet('Sheet1')];
    const ss = {
      getId: () => id,
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
      getSheetByName: n => sheets.find(s => s.getName() === n) || null,
      insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
      getSheets: () => sheets.slice(),
      deleteSheet: s => { sheets.splice(sheets.indexOf(s), 1); },
      setSpreadsheetTimeZone: () => {}
    };
    spreadsheets[id] = ss;
    files[id] = { id, name, moveTo: () => {} };
    return ss;
  }

  const SpreadsheetApp = {
    create: makeSpreadsheet,
    openById: id => { if (!spreadsheets[id]) throw new Error('No spreadsheet ' + id); return spreadsheets[id]; },
    flush: () => {}
  };

  // ---------- Drive ----------
  function makeFolder(name, parent) {
    const id = newId('folder');
    const folder = {
      id, name, parent, trashed: false,
      getId: () => id,
      getName: () => name,
      getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      isTrashed: () => folder.trashed,
      createFolder: n => makeFolder(n, folder),
      getFoldersByName: n => {
        const list = Object.values(folders).filter(f => f.parent === folder && f.name === n && !f.trashed);
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
      createFile: blob => {
        const fid = newId('file');
        const file = {
          id: fid, name: blob._name, mime: blob._mime, bytes: blob._bytes, folder, trashed: false,
          getId: () => fid,
          setName: n => { file.name = n; return file; },
          getName: () => file.name,
          getBlob: () => ({ getBytes: () => file.bytes }),
          setTrashed: t => { file.trashed = t; return file; },
          moveTo: f => { file.folder = f; return file; }
        };
        files[fid] = file;
        return file;
      }
    };
    folders[id] = folder;
    return folder;
  }
  const rootDrive = makeFolder('My Drive', null);
  const DriveApp = {
    createFolder: n => rootDrive.createFolder(n),
    getFolderById: id => { if (!folders[id]) throw new Error('No folder ' + id); return folders[id]; },
    getFileById: id => { if (!files[id]) throw new Error('No file ' + id); return files[id]; }
  };

  // ---------- Utilities ----------
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, value) => {
      const input = Array.isArray(value) ? toBuf(value) : Buffer.from(String(value), 'utf8');
      return toSigned(crypto.createHash(alg).update(input).digest());
    },
    base64Decode: s => {
      if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('Invalid base64');
      return toSigned(Buffer.from(s, 'base64'));
    },
    base64Encode: bytes => toBuf(bytes).toString('base64'),
    newBlob: (bytes, mime, name) => ({ _bytes: bytes, _mime: mime, _name: name, getBytes: () => bytes }),
    getUuid: () => crypto.randomUUID(),
    formatDate,
    parseDate
  };

  const env = {
    SpreadsheetApp, DriveApp, Utilities,
    Session: { getScriptTimeZone: () => 'Africa/Algiers' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache[k] ?? null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } })
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } })
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => { const t = { timeBased: () => t, everyDays: () => t, atHour: () => t, create: () => t }; return t; }
    },
    console: {
      log: (...a) => logs.push(a.join(' ')),
      warn: (...a) => logs.push(a.join(' ')),
      error: (...a) => { logs.push(a.join(' ')); console.error(...a); }
    }
  };

  const context = vm.createContext(env);
  const dir = process.env.GAS_DIR || path.join(__dirname, '..', 'backend');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, context, { filename: 'backend.gs' });

  return {
    context, logs, files, folders, spreadsheets, props, cache,
    run: expr => vm.runInContext(expr, context),
    post: body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
    sheet: name => {
      const ss = spreadsheets[props.SPREADSHEET_ID];
      return ss.getSheetByName(name)._data;
    }
  };
}

module.exports = { createEnv };
