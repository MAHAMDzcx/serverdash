'use strict';
const fs = require('fs');
const path = require('path');

// تخزين JSON بسيط وآمن: كتابة ذرّية (ملف مؤقت ثم rename) مع تأجيل الحفظ.
class JsonStore {
  constructor(file, defaults, delay = 300) {
    this.file = file; this.delay = delay; this.timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = this._load(defaults);
  }
  _load(defaults) {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...JSON.parse(JSON.stringify(defaults)), ...parsed };
      throw new Error('invalid');
    } catch (e) {
      if (e.code !== 'ENOENT') {
        try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); console.error(`[store] الملف ${this.file} تالف؛ تم حفظ نسخة منه وإنشاء ملف جديد.`); } catch {}
      }
      return JSON.parse(JSON.stringify(defaults));
    }
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delay);
    if (this.timer.unref) this.timer.unref();
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('[store] فشل حفظ البيانات:', e.message); }
  }
}
module.exports = { JsonStore };
