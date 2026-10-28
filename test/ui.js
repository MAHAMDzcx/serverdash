'use strict';
// اختبار الواجهة: يشغّل app.js الحقيقي داخل DOM مبسّط فوق الخادم الحي.
const { spawn } = require('child_process');
const vm = require('vm'); const fs = require('fs'); const os = require('os'); const path = require('path'); const net = require('net');
const APP = 3191, MC = 25992, BASE = `http://127.0.0.1:${APP}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗ FAIL:', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vi = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
const pk = (id, p) => { const b = Buffer.concat([vi(id), p]); return Buffer.concat([vi(b.length), b]); };
const mc = net.createServer((s) => { let buf = Buffer.alloc(0), n = 0; s.on('data', (d) => { buf = Buffer.concat([buf, d]); for (;;) { let len = 0, sz = 0, b; do { if (sz >= buf.length) return; b = buf[sz]; len |= (b & 127) << (7 * sz); sz++; } while (b & 128); if (buf.length < sz + len) return; const body = buf.subarray(sz, sz + len); buf = buf.subarray(sz + len); n++; if (n === 2) { const j = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.20.4', protocol: 765 }, players: { online: 2, max: 50, sample: [] }, description: 'Hello MOTD' })); s.write(pk(0, Buffer.concat([vi(j.length), j]))); } else if (n === 3) s.write(pk(1, body.subarray(1))); } }); s.on('error', () => {}); });

/* ---- DOM مبسّط ---- */
const byId = new Map(); let allNodes = [];
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._text = null; this.style = {}; this.parent = null; this.dataset = {}; allNodes.push(this); this.classList = { add: (c) => { if (!this.className.split(' ').includes(c)) this.className = (this.className + ' ' + c).trim(); }, remove: (c) => { this.className = this.className.split(' ').filter((x) => x !== c).join(' '); }, toggle: (c) => { this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c); }, contains: (c) => this.className.split(' ').includes(c) }; }
  get nodeType() { return 1; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') byId.set(v, this); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; } hasAttribute(k) { return k in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; } get hidden() { return 'hidden' in this.attrs; }
  set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; } get disabled() { return 'disabled' in this.attrs; }
  set value(v) { this._value = String(v); } get value() { return this._value ?? this.attrs.value ?? ''; }
  set checked(v) { this._checked = !!v; } get checked() { return this._checked ?? ('checked' in this.attrs); }
  set placeholder(v) { this.attrs.placeholder = v; } get placeholder() { return this.attrs.placeholder; }
  set src(v) { this.attrs.src = v; } get src() { return this.attrs.src; }
  set content(v) { this.attrs.content = v; } get content() { return this.attrs.content; }
  set innerHTML(v) { this._inner = v; }
  _adopt(k) { if (k && k.parent) k.parent.children = k.parent.children.filter((x) => x !== k); if (k) k.parent = this; }
  append(...ks) { for (const k of ks) { const n = typeof k === 'string' ? new T(k) : k; this._adopt(n); this.children.push(n); } }
  prepend(k) { this._adopt(k); this.children.unshift(k); }
  replaceChildren(...ks) { for (const c of this.children) c.parent = null; this.children = []; this.append(...ks); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  get firstChild() { return this.children[0]; } get lastChild() { return this.children[this.children.length - 1]; }
  get textContent() { return this._text !== null && !this.children.length ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener() {} focus() {} scrollIntoView() {} closest() { return null; }
  get scrollHeight() { return 0; } get scrollTop() { return 0; } set scrollTop(v) {} get clientHeight() { return 0; }
  fire(t, extra = {}) { const ev = { type: t, target: this, currentTarget: this, preventDefault() {}, ...extra }; for (const f of this.listeners[t] || []) f(ev); }
  find(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) if (c.find) c.find(pred, out); return out; }
}
class T { constructor(t) { this.t = t; this.parent = null; } get nodeType() { return 3; } get textContent() { return this.t; } remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); } }
const body = new N('body'), head = new N('head');
const root = new N('div'); root.setAttribute('id', 'root'); const toasts = new N('div'); toasts.setAttribute('id', 'toasts'); body.append(root, toasts);
const metaTheme = new N('meta'); metaTheme.attrs.content = '';
const docListeners = {};
const document = { body, hidden: false, documentElement: new N('html'), createElement: (t) => new N(t), createElementNS: (_, t) => new N(t), createTextNode: (t) => new T(t),
  getElementById: (id) => byId.get(id) || null, querySelector: (s) => (s === 'meta[name=theme-color]' ? metaTheme : s === '.app' ? allNodes.reverse().find((n) => n.className.split(' ').includes('app') && n.parent) || (allNodes.reverse(), null) : null),
  addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); }, removeEventListener() {} };
// نجمع الأخطاء
const errors = []; const jar = {};
const ctx = { document, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Promise, JSON, Math, Date, Object, Array, String, Number, Error, Set, Map, encodeURIComponent,
  localStorage: { getItem: () => null, setItem: () => {} }, navigator: { clipboard: { writeText: async () => {} } }, location: { reload() {} },
  window: { addEventListener: (t, f) => { if (t === 'unhandledrejection') ctx._rej = f; } },
  fetch: async (p, o = {}) => { const res = await fetch(BASE + p, { ...o, headers: { ...(o.headers || {}), Cookie: jar.c || '' } }); const sc = (res.headers.get('set-cookie') || '').split(';')[0]; if (sc) jar.c = sc.endsWith('=') ? '' : sc; return res; } };
ctx.window.document = document; vm.createContext(ctx);
process.on('unhandledRejection', (e) => errors.push('unhandledRejection: ' + (e && e.stack || e)));

(async () => {
  await new Promise((r) => mc.listen(MC, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdui-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(APP), HOST: '127.0.0.1', DATA_DIR: dataDir, ALLOW_PRIVATE_HOSTS: '1', SD_MINEFLAYER_PATH: path.join(__dirname, 'fake', 'mineflayer.js') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(100); }
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const textAll = () => root.textContent + toasts.textContent + body.children.map((c) => c.textContent).join('');
  const btn = (label) => body.find((n) => n.tag === 'button' && n.textContent.includes(label))[0];
  const inputs = (scope) => scope.find((n) => n.tag === 'input');
  try {
    console.log('\n— الواجهة: شاشة الدخول');
    vm.runInContext(src, ctx, { filename: 'app.js' }); await sleep(500);
    ok(root.textContent.includes('تسجيل الدخول') && root.textContent.includes('حساب جديد'), 'تظهر شاشة الدخول مع تبويب حساب جديد');
    btn('حساب جديد').fire('click'); await sleep(50);
    ok(root.textContent.includes('إنشاء الحساب'), 'تبويب التسجيل يعمل');
    const form = root.find((n) => n.tag === 'form')[0]; const [nm, em, pw] = inputs(form);
    nm.value = 'مستخدم'; em.value = 'ui@test.com'; pw.value = '12'; form.fire('submit'); await sleep(400);
    ok(root.textContent.includes('8 أحرف') || root.textContent.includes('كلمة المرور يجب'), 'خطأ كلمة المرور القصيرة يظهر في الواجهة');
    pw.value = 'long-enough-pass'; form.fire('submit'); await sleep(1200);

    console.log('\n— الواجهة: لوحة التحكم الفارغة');
    ok(root.textContent.includes('لا توجد سيرفرات بعد'), 'حالة فارغة صادقة بدون سيرفرات وهمية');
    ok(root.textContent.includes('مستخدم') && root.textContent.includes('ui@test.com'), 'اسم المستخدم يظهر');

    console.log('\n— الواجهة: إضافة سيرفر');
    btn('إضافة سيرفر').fire('click'); await sleep(50);
    const modalBack = body.children.find((c) => c.className === 'modal-back'); ok(!!modalBack, 'تفتح نافذة الإضافة');
    const mform = modalBack.find((n) => n.tag === 'form')[0]; const ins = inputs(mform);
    ins[0].value = 'سيرفري'; ins[1].value = `127.0.0.1:${MC}`; ins[2].value = '25565'; ins[3].value = 'UiBot'; mform.fire('submit'); await sleep(1800);
    ok(!body.children.find((c) => c.className === 'modal-back'), 'تُغلق النافذة بعد النجاح (host:port يُفصل تلقائيًا)');
    const t = root.textContent;
    ok(t.includes('سيرفري') && t.includes(`127.0.0.1:${MC}`), 'اسم وعنوان السيرفر ظاهران');
    ok(t.includes('Paper 1.20.4'), 'إصدار السيرفر الحقيقي ظاهر');
    ok(t.includes('2 / 50'), 'عدد اللاعبين 2 / 50 من الفحص الحقيقي');
    ok(t.includes('Hello MOTD'), 'MOTD ظاهر');
    ok(t.includes('داخل السيرفر'), 'حالة البوت: داخل السيرفر');
    ok(t.includes('18 / 20') && t.includes('15 / 20'), 'صحة وجوع البوت');
    ok(t.includes('X 10') && t.includes('Z -4'), 'إحداثيات البوت');
    ok(t.includes('بقاء') && t.includes('العالم العادي'), 'وضع اللعب والبُعد بالعربية');
    ok(t.includes('Steve'), 'لاعبو البوت ظاهرون');
    ok(t.includes('دخل البوت UiBot'), 'سجل الأحداث يحتوي دخول البوت');

    console.log('\n— الواجهة: التحكم');
    btn('إيقاف').fire('click'); await sleep(1500);
    ok(root.textContent.includes('متوقف'), 'بعد الإيقاف تظهر حالة متوقف');
    ok(!root.textContent.includes('18 / 20'), 'تختفي بيانات البوت الحية بعد الإيقاف (لا بيانات قديمة)');
    const startBtn = btn('تشغيل البوت'); ok(!startBtn.hidden, 'زر التشغيل يظهر');
    startBtn.fire('click'); await sleep(1800); ok(root.textContent.includes('داخل السيرفر'), 'التشغيل من جديد يعمل');
    btn('تعديل').fire('click'); await sleep(50); ok(!!body.children.find((c) => c.className === 'modal-back'), 'نافذة التعديل تفتح');
    body.children.find((c) => c.className === 'modal-back').remove();
    body.find((n) => n.attrs && n.attrs['aria-label'] === 'تسجيل الخروج')[0].fire('click'); await sleep(500); ok(root.textContent.includes('تسجيل الدخول') && !root.textContent.includes('سيرفري'), 'تسجيل الخروج يعيد لشاشة الدخول');
  } catch (e) { errors.push(e.stack || String(e)); }
  child.kill('SIGTERM'); mc.close();
  ok(!errors.length, 'لا أخطاء JavaScript أثناء التشغيل' + (errors.length ? '\n' + errors.join('\n') : ''));
  ok(!/Error/.test(stderr), 'لا أخطاء في الخادم');
  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`); process.exit(fail ? 1 : 0);
})();
