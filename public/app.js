'use strict';
/* ServerDash — الواجهة الأمامية. كل البيانات المعروضة تأتي من الخادم (فحص حقيقي للسيرفر + بوت Mineflayer). */

const ICONS = {
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  play: '<path d="M7 5l12 7-12 7z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  logout: '<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ''; // نصوص ثابتة داخلية فقط
  return s;
}
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
const $root = document.getElementById('root');
const setText = (el, v) => { const t = v == null || v === '' ? '—' : String(v); if (el.textContent !== t) el.textContent = t; };

/* ---------- الحالة العامة ---------- */
const S = { user: null, allowRegistration: true, servers: [], selectedId: null, refs: null, detail: null, tick: null, busy: false, theme: 'dark', lastList: 0 };
try { S.theme = localStorage.getItem('sd_theme') || 'dark'; } catch { /* */ }
applyTheme(S.theme);
function applyTheme(t) { S.theme = t; document.documentElement.dataset.theme = t; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0b1015' : '#f2f5f9'; try { localStorage.setItem('sd_theme', t); } catch { /* */ } }

/* ---------- الشبكة ---------- */
class ApiError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }
let offlineBar = null;
function setOffline(off) {
  if (off && !offlineBar) { offlineBar = h('div', { class: 'offline', text: 'انقطع الاتصال بالخادم… نحاول مجددًا تلقائيًا.' }); document.body.prepend(offlineBar); }
  if (!off && offlineBar) { offlineBar.remove(); offlineBar = null; }
}
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ServerDash' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { setOffline(true); throw new ApiError('تعذّر الوصول إلى الخادم. تحقق من الاتصال.', 0); }
  setOffline(false);
  let data = {}; try { data = await res.json(); } catch { /* */ }
  if (!res.ok) {
    if (res.status === 401 && data.code === 'AUTH_REQUIRED') loggedOut();
    throw new ApiError(data.error || `تعذّر تنفيذ الطلب (${res.status})`, res.status, data.code);
  }
  return data;
}
function toast(msg, bad = false) {
  const t = h('div', { class: 'toast' + (bad ? ' err' : ''), role: bad ? 'alert' : 'status', text: msg });
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), bad ? 6000 : 3500);
}
window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); if (e.reason instanceof ApiError) return; console.error(e.reason); toast('حدث خطأ غير متوقع في الصفحة.', true); });

/* ---------- تنسيقات ---------- */
const BOT_LABEL = { stopped: 'متوقف', connecting: 'جارٍ الاتصال…', online: 'داخل السيرفر', reconnecting: 'إعادة الاتصال…', error: 'فشل الاتصال' };
const GM = { survival: 'بقاء', creative: 'إبداعي', adventure: 'مغامرة', spectator: 'مشاهد' };
const DIM = { overworld: 'العالم العادي', the_nether: 'الجحيم (Nether)', nether: 'الجحيم (Nether)', the_end: 'الإند (End)', end: 'الإند (End)' };
function dur(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (d ? `${d}ي ` : '') + (hh ? `${hh}س ` : '') + (m || hh || d ? `${m}د ` : '') + `${x}ث`; }
const pad = (n) => String(n).padStart(2, '0');
function clock(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

/* ---------- نوافذ ---------- */
function modal(content) {
  const back = h('div', { class: 'modal-back' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content));
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey); document.body.append(back);
  return { back, close };
}
function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    let m; const done = (v) => { m.close(); resolve(v); };
    m = modal([h('h3', { text: title }), h('p', { class: 'sub', text }), h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: () => done(false), text: 'إلغاء' }), h('button', { class: 'btn danger', type: 'button', onclick: () => done(true), text: okLabel }))]);
    m.back.addEventListener('mousedown', (e) => { if (e.target === m.back) resolve(false); });
  });
}
async function withBusy(btn, fn) {
  if (btn.disabled) return; btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}

/* ---------- شاشة الدخول ---------- */
function renderAuth(mode = 'login') {
  stopPolling(); S.refs = null;
  const isReg = mode === 'register';
  const err = h('div', { class: 'alert err', hidden: true, role: 'alert' });
  const name = h('input', { class: 'input', name: 'name', autocomplete: 'name', maxlength: '40', required: true });
  const email = h('input', { class: 'input ltr', type: 'email', name: 'email', autocomplete: 'email', required: true, maxlength: '120' });
  const pass = h('input', { class: 'input ltr', type: 'password', name: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true, minlength: isReg ? '8' : null, maxlength: '128' });
  const submit = h('button', { class: 'btn primary block', type: 'submit', text: isReg ? 'إنشاء الحساب' : 'تسجيل الدخول' });
  const form = h('form', { novalidate: true },
    err,
    isReg && h('div', { class: 'field' }, h('label', { text: 'الاسم' }), name),
    h('div', { class: 'field' }, h('label', { text: 'البريد الإلكتروني' }), email),
    h('div', { class: 'field' }, h('label', { text: 'كلمة المرور' }), pass, isReg && h('span', { class: 'hint', text: '8 أحرف على الأقل.' })),
    submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.hidden = true;
    withBusy(submit, async () => {
      try {
        const body = isReg ? { name: name.value, email: email.value, password: pass.value } : { email: email.value, password: pass.value };
        const d = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
        S.user = d.user; await startApp();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  });
  const tabs = h('div', { class: 'tabs' },
    h('button', { type: 'button', class: !isReg ? 'on' : '', onclick: () => renderAuth('login'), text: 'تسجيل الدخول' }),
    S.allowRegistration ? h('button', { type: 'button', class: isReg ? 'on' : '', onclick: () => renderAuth('register'), text: 'حساب جديد' }) : h('button', { type: 'button', disabled: true, text: 'التسجيل مغلق' }));
  $root.replaceChildren(h('main', { class: 'auth' }, h('section', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('server')), h('div', {}, h('h1', { text: 'ServerDash' }), h('small', { text: 'لوحة تحكم بوتات ماينكرافت' }))),
    tabs, form)));
  (isReg ? name : email).focus();
}

/* ---------- الهيكل ---------- */
function renderShell() {
  const app = h('div', { class: 'app' });
  const list = h('div', { class: 'srv-list', id: 'srv-list' });
  const themeBtn = h('button', { class: 'btn ghost icon', type: 'button', title: 'تبديل المظهر', 'aria-label': 'تبديل المظهر', onclick: () => { applyTheme(S.theme === 'dark' ? 'light' : 'dark'); themeBtn.replaceChildren(icon(S.theme === 'dark' ? 'sun' : 'moon')); } }, icon(S.theme === 'dark' ? 'sun' : 'moon'));
  const side = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('server')), h('div', {}, h('h1', { text: 'ServerDash' }), h('small', { text: 'بوتات ماينكرافت' }))),
    h('button', { class: 'btn primary block', type: 'button', onclick: () => openServerModal(), id: 'add-btn' }, icon('plus'), 'إضافة سيرفر'),
    h('div', { class: 'srv-label', text: 'سيرفراتي' }), list,
    h('div', { class: 'side-foot' }, h('div', { class: 'avatar', text: (S.user.name || '؟').slice(0, 1) }), h('div', { class: 'who' }, h('b', { text: S.user.name }), h('small', { text: S.user.email })), S.user.role === 'admin' && h('a', { class: 'btn ghost icon', href: '/admin', title: 'لوحة الإدارة', 'aria-label': 'لوحة الإدارة', text: '⚙' }), themeBtn,
      h('button', { class: 'btn ghost icon', type: 'button', title: 'تسجيل الخروج', 'aria-label': 'تسجيل الخروج', onclick: doLogout }, icon('logout'))));
  const title = h('b', { id: 'top-title', text: 'ServerDash' });
  const top = h('header', { class: 'topbar' }, h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'القائمة', onclick: () => app.classList.toggle('open') }, icon('menu')), title);
  const view = h('div', { id: 'view' });
  app.append(side, h('div', { class: 'scrim', onclick: () => app.classList.remove('open') }), h('div', { style: 'min-width:0' }, top, h('main', { class: 'main' }, view)));
  $root.replaceChildren(app);
}
async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* */ }
  loggedOut();
}
function loggedOut() { S.user = null; S.servers = []; S.selectedId = null; renderAuth('login'); }

function renderList() {
  const list = document.getElementById('srv-list'); if (!list) return;
  list.replaceChildren(...S.servers.map((s) => h('button', { class: 'srv-item' + (s.id === S.selectedId ? ' on' : ''), type: 'button', onclick: () => select(s.id) },
    h('i', { class: `dot ${s.runtime.status}` }), h('div', { class: 't' }, h('b', { text: s.name }), h('span', { class: 'a', text: `${s.host}:${s.port}` })))));
}
function select(id) {
  S.selectedId = id; document.querySelector('.app')?.classList.remove('open');
  renderList(); buildDetail(); poll(true);
}

/* ---------- صفحة السيرفر ---------- */
function emptyState() {
  S.refs = null; S.refsFor = null; document.getElementById('top-title').textContent = 'ServerDash'; document.title = 'ServerDash';
  document.getElementById('view').replaceChildren(h('div', { class: 'empty' }, h('div', {}, h('div', { class: 'big' }, icon('server')), h('h2', { text: 'لا توجد سيرفرات بعد' }),
    h('p', { text: 'أضف عنوان سيرفر ماينكرافت واسم البوت، وسيدخل البوت إلى السيرفر مباشرة وتظهر لك المعلومات الحقيقية.' }),
    h('button', { class: 'btn primary', type: 'button', onclick: () => openServerModal() }, icon('plus'), 'إضافة أول سيرفر'))));
}
function kv(rows) { return h('dl', { class: 'kv' }, rows.map(([k, el]) => h('div', {}, h('dt', { text: k }), h('dd', {}, el)))); }
const span = (cls) => h('span', cls ? { class: cls } : {});

function buildDetail() {
  const s = S.servers.find((x) => x.id === S.selectedId);
  if (!s) return emptyState();
  const r = {};
  document.getElementById('top-title').textContent = s.name; document.title = `${s.name} — ServerDash`;
  r.fav = h('div', { class: 'fav' }); r.name = h('h2'); r.addr = span('mono');
  r.chipSrv = h('span', { class: 'chip' }, h('i', { class: 'dot' }), h('span')); r.chipBot = h('span', { class: 'chip' }, h('i', { class: 'dot' }), h('span'));
  r.btnStart = h('button', { class: 'btn primary', type: 'button', onclick: (e) => act(e.currentTarget, 'start') }, icon('play'), 'تشغيل البوت');
  r.btnRestart = h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, 'restart') }, icon('refresh'), 'إعادة تشغيل');
  r.btnStop = h('button', { class: 'btn danger', type: 'button', onclick: (e) => act(e.currentTarget, 'stop') }, icon('stop'), 'إيقاف');
  r.btnEdit = h('button', { class: 'btn', type: 'button', onclick: () => openServerModal(S.servers.find((x) => x.id === S.selectedId)) }, icon('edit'), 'تعديل');
  r.btnDel = h('button', { class: 'btn danger ghost icon', type: 'button', title: 'حذف السيرفر', 'aria-label': 'حذف السيرفر', onclick: delServer }, icon('trash'));
  r.alerts = h('div');
  const copy = h('button', { class: 'btn ghost icon sm', type: 'button', title: 'نسخ العنوان', 'aria-label': 'نسخ العنوان', style: 'width:34px', onclick: async () => { try { await navigator.clipboard.writeText(`${r.host}:${r.port}`); toast('تم نسخ العنوان'); } catch { toast('تعذّر النسخ تلقائيًا', true); } } }, icon('copy'));

  const hero = h('section', { class: 'card hero' },
    h('div', { class: 'id' }, r.fav, h('div', { style: 'min-width:0' }, r.name, h('div', { class: 'addr' }, r.addr, copy), h('div', { class: 'chips' }, r.chipSrv, r.chipBot))),
    h('div', { class: 'actions' }, r.btnStart, r.btnRestart, r.btnStop, r.btnEdit, r.btnDel));

  const f = {}; // حقول معلومات السيرفر
  for (const k of ['state', 'motd', 'version', 'players', 'latency', 'checked']) f[k] = span();
  f.motd.style.whiteSpace = 'pre-line';
  const srvCard = h('section', { class: 'card' }, h('h3', {}, icon('server'), 'معلومات السيرفر (فحص مباشر)'),
    kv([['الحالة', f.state], ['الوصف (MOTD)', f.motd], ['إصدار السيرفر', f.version], ['اللاعبون المتصلون', f.players], ['زمن الاستجابة', f.latency], ['آخر فحص', f.checked]]));
  r.f = f;

  const b = {}; for (const k of ['status', 'user', 'uptime', 'version', 'mode', 'dim', 'pos', 'time', 'ping']) b[k] = span();
  b.hpTxt = span(); b.hpBar = h('div', { class: 'bar hp' }, h('i')); b.foodTxt = span(); b.foodBar = h('div', { class: 'bar food' }, h('i'));
  const botCard = h('section', { class: 'card' }, h('h3', {}, icon('bot'), 'حالة البوت'),
    kv([['الحالة', b.status], ['اسم البوت', b.user], ['مدة البقاء داخل السيرفر', b.uptime], ['إصدار الاتصال', b.version], ['الصحة', h('div', {}, b.hpTxt, b.hpBar)], ['الجوع', h('div', {}, b.foodTxt, b.foodBar)], ['وضع اللعب', b.mode], ['البُعد', b.dim], ['الموقع', b.pos], ['وقت اللعبة', b.time], ['بنق البوت', b.ping]]));
  r.b = b;

  r.players = h('div', { class: 'pl' }); r.playersNote = h('p', { class: 'hint' });
  const plCard = h('section', { class: 'card' }, h('h3', {}, icon('users'), 'اللاعبون'), r.players, r.playersNote);

  r.logs = h('div', { class: 'logs', tabindex: '0' });
  r.chatInput = h('input', { class: 'input', maxlength: '250', placeholder: 'اكتب رسالة ليرسلها البوت في الشات…', autocomplete: 'off' });
  r.chatBtn = h('button', { class: 'btn primary', type: 'submit' }, icon('send'), 'إرسال');
  const chat = h('form', { class: 'chat', novalidate: true }, r.chatInput, r.chatBtn);
  chat.addEventListener('submit', (e) => { e.preventDefault(); const m = r.chatInput.value.trim(); if (!m) return; withBusy(r.chatBtn, async () => { try { await api(`/api/servers/${S.selectedId}/chat`, { method: 'POST', body: { message: m } }); r.chatInput.value = ''; poll(true); } catch (ex) { toast(ex.message, true); } }); });
  const logCard = h('section', { class: 'card wide' }, h('h3', {}, icon('list'), 'سجل الأحداث'), r.logs, chat);

  r.host = s.host; r.port = s.port; r.sig = '';
  document.getElementById('view').replaceChildren(hero, r.alerts, h('div', { class: 'grid' }, srvCard, botCard, plCard, logCard));
  S.refs = r; S.refsFor = s.id; S.detail = null;
  fillStatic(s);
}
function fillStatic(s) {
  const r = S.refs; if (!r) return;
  setText(r.name, s.name); setText(r.addr, `${s.host}:${s.port}`); r.host = s.host; r.port = s.port;
  if (!r.faviconSet) setText(r.fav, (s.name || '?').slice(0, 1));
}

function chip(el, cls, text) { el.firstChild.className = `dot ${cls}`; setText(el.lastChild, text); }
function updateDetail(d) {
  const r = S.refs; if (!r || d.server.id !== S.selectedId) return;
  S.detail = { ...d, recvAt: Date.now() };
  const st = d.runtime.status, live = d.runtime.live, p = d.ping, pd = p.data;
  const active = ['connecting', 'online', 'reconnecting'].includes(st);
  // رأس الصفحة
  fillStatic(d.server);
  if (pd && pd.favicon) { if (r.faviconSrc !== pd.favicon) { r.faviconSrc = pd.favicon; r.fav.replaceChildren(h('img', { src: pd.favicon, alt: '' })); r.faviconSet = true; } }
  else if (r.faviconSet) { r.faviconSet = false; r.faviconSrc = null; r.fav.replaceChildren(); setText(r.fav, (d.server.name || '?').slice(0, 1)); }
  chip(r.chipSrv, p.state === 'online' ? 'online' : p.state === 'offline' ? 'error' : 'connecting', p.state === 'online' ? 'السيرفر يعمل' : p.state === 'offline' ? 'السيرفر لا يستجيب' : 'جارٍ فحص السيرفر…');
  chip(r.chipBot, st, `البوت: ${BOT_LABEL[st] || st}${st === 'reconnecting' && d.runtime.nextRetryInMs != null ? ` (بعد ${Math.ceil(d.runtime.nextRetryInMs / 1000)}ث)` : ''}`);
  r.btnStart.hidden = active; r.btnRestart.hidden = !active; r.btnStop.hidden = !active;
  // التنبيهات
  const alerts = [];
  if (d.runtime.kicked && st !== 'online') alerts.push(h('div', { class: 'alert err', text: `سبب الطرد: ${d.runtime.kicked}` }));
  if (d.runtime.lastError && st !== 'online') alerts.push(h('div', { class: 'alert err', text: d.runtime.lastError }));
  if (p.state === 'offline' && p.error) alerts.push(h('div', { class: 'alert warn', text: `تعذّر فحص السيرفر: ${p.error}. إن كان السيرفر على Aternos أو استضافة مشابهة فيجب تشغيله من موقع الاستضافة أولًا.` }));
  const sig = alerts.map((a) => a.textContent).join('|');
  if (sig !== r.alertSig) { r.alertSig = sig; r.alerts.replaceChildren(...alerts); }
  // معلومات السيرفر (من الفحص فقط)
  const f = r.f;
  setText(f.state, p.state === 'online' ? 'يعمل' : p.state === 'offline' ? 'لا يستجيب' : 'جارٍ الفحص…');
  setText(f.motd, pd && pd.motd); setText(f.version, pd && pd.version.name ? `${pd.version.name}${pd.version.protocol != null ? ` (بروتوكول ${pd.version.protocol})` : ''}` : null);
  setText(f.players, pd && pd.players.online != null ? `${pd.players.online}${pd.players.max != null ? ` / ${pd.players.max}` : ''}` : null);
  setText(f.latency, pd && pd.latency != null ? `${pd.latency} مللي ثانية` : null);
  setText(f.checked, p.checkedAt ? `قبل ${Math.max(0, Math.round((d.serverTime - p.checkedAt) / 1000))} ثانية` : null);
  // حالة البوت (من Mineflayer فقط)
  const b = r.b;
  setText(b.status, BOT_LABEL[st] || st); setText(b.user, d.server.username);
  r.uptimeBase = live ? { ms: live.uptimeMs, at: Date.now() } : null; tickUptime();
  setText(b.version, live && live.version);
  setText(b.mode, live && live.gamemode && (GM[live.gamemode] || live.gamemode));
  setText(b.dim, live && live.dimension && (DIM[String(live.dimension).replace(/^minecraft:/, '')] || live.dimension));
  setText(b.pos, live && live.position ? `X ${Math.floor(live.position.x)}  Y ${Math.floor(live.position.y)}  Z ${Math.floor(live.position.z)}` : null);
  b.pos.className = live && live.position ? 'mono' : '';
  setText(b.time, live && live.timeOfDay != null ? (live.timeOfDay % 24000 < 12000 ? 'نهار' : 'ليل') + ` (${live.timeOfDay % 24000})` : null);
  setText(b.ping, live && live.ping != null ? `${live.ping} مللي ثانية` : null);
  const hp = live && live.health != null ? Math.max(0, Math.min(20, live.health)) : null, fd = live && live.food != null ? Math.max(0, Math.min(20, live.food)) : null;
  setText(b.hpTxt, hp != null ? `${Math.round(hp * 10) / 10} / 20` : null); r.b.hpBar.firstChild.style.width = hp != null ? `${hp * 5}%` : '0';
  setText(b.foodTxt, fd != null ? `${fd} / 20` : null); r.b.foodBar.firstChild.style.width = fd != null ? `${fd * 5}%` : '0';
  // اللاعبون
  let names, note;
  if (live) { names = live.players.map((x) => ({ n: x.name, me: x.name === d.server.username, ping: x.ping })); note = names.length ? '' : 'لا يوجد لاعبون ظاهرون للبوت.'; }
  else if (pd && pd.players.sample.length) { names = pd.players.sample.map((n) => ({ n })); note = 'عيّنة من اللاعبين يعرضها السيرفر نفسه (قد لا تكون كاملة). تظهر القائمة الكاملة عند دخول البوت.'; }
  else { names = []; note = pd ? (pd.players.online ? 'السيرفر لا يعرض أسماء اللاعبين. تظهر القائمة الكاملة عند دخول البوت.' : 'لا يوجد لاعبون الآن.') : 'لا تتوفر بيانات بعد.'; }
  const psig = JSON.stringify(names) + note;
  if (psig !== r.psig) { r.psig = psig; r.players.replaceChildren(...names.map((x) => h('span', { class: 'chip' + (x.me ? ' me' : '') }, x.n, x.ping != null ? h('small', { text: `${x.ping}ms` }) : null))); setText(r.playersNote, note); r.playersNote.hidden = !note; }
  // السجل
  const lsig = d.logs.length + ':' + (d.logs.length ? d.logs[d.logs.length - 1].t : 0);
  if (lsig !== r.lsig) {
    r.lsig = lsig; const atBottom = r.logs.scrollHeight - r.logs.scrollTop - r.logs.clientHeight < 40;
    r.logs.replaceChildren(...(d.logs.length ? d.logs.map((l) => h('div', { class: `log ${l.level}` }, h('time', { text: clock(l.t) }), h('span', { text: l.message }))) : [h('div', { class: 'muted', text: 'لا توجد أحداث بعد.' })]));
    if (atBottom) r.logs.scrollTop = r.logs.scrollHeight;
  }
  r.chatInput.disabled = st !== 'online'; r.chatBtn.disabled = st !== 'online';
  r.chatInput.placeholder = st === 'online' ? 'اكتب رسالة ليرسلها البوت في الشات…' : 'الشات متاح فقط عندما يكون البوت داخل السيرفر';
}
function tickUptime() { const r = S.refs; if (!r) return; setText(r.b.uptime, r.uptimeBase ? dur(r.uptimeBase.ms + (Date.now() - r.uptimeBase.at)) : null); }

/* ---------- الأوامر ---------- */
const DONE = { start: 'بدأ دخول البوت إلى السيرفر', stop: 'تم إيقاف البوت', restart: 'أُعيد تشغيل البوت' };
function act(btn, kind) {
  return withBusy(btn, async () => { try { await api(`/api/servers/${S.selectedId}/${kind}`, { method: 'POST' }); toast(DONE[kind]); await poll(true); } catch (e) { toast(e.message, true); } });
}
async function delServer() {
  const s = S.servers.find((x) => x.id === S.selectedId); if (!s) return;
  if (!(await confirmDialog('حذف السيرفر؟', `سيتم إيقاف البوت وحذف «${s.name}» وسجلّه نهائيًا.`, 'حذف'))) return;
  try { await api(`/api/servers/${s.id}`, { method: 'DELETE' }); toast('تم حذف السيرفر'); S.selectedId = null; await loadList(); } catch (e) { toast(e.message, true); }
}

function openServerModal(existing) {
  const editing = !!existing; let m;
  const err = h('div', { class: 'alert err', hidden: true, role: 'alert' });
  const name = h('input', { class: 'input', maxlength: '60', required: true, value: editing ? existing.name : '', placeholder: 'مثال: سيرفر الأصدقاء' });
  const host = h('input', { class: 'input ltr', dir: 'ltr', required: true, value: editing ? existing.host : '', placeholder: 'play.example.com', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
  const port = h('input', { class: 'input ltr', dir: 'ltr', type: 'number', min: '1', max: '65535', required: true, value: editing ? existing.port : '25565' });
  const user = h('input', { class: 'input ltr', dir: 'ltr', required: true, maxlength: '16', value: editing ? existing.username : '', placeholder: 'MyBot', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
  const ver = h('input', { class: 'input ltr', dir: 'ltr', value: editing && existing.version ? existing.version : '', placeholder: 'تلقائي (موصى به)', autocomplete: 'off' });
  const pw = h('input', { class: 'input ltr', dir: 'ltr', type: 'password', autocomplete: 'new-password', placeholder: editing && existing.hasPassword ? 'اتركه فارغًا للإبقاء على الحالية' : 'اختياري' });
  const afk = h('input', { type: 'checkbox', checked: editing ? existing.antiAfk : true });
  const rec = h('input', { type: 'checkbox', checked: editing ? existing.autoReconnect : true });
  const rmPw = editing && existing.hasPassword ? h('input', { type: 'checkbox' }) : null;
  const submit = h('button', { class: 'btn primary', type: 'submit', text: editing ? 'حفظ التعديلات' : 'إضافة وتشغيل البوت' });
  const form = h('form', { novalidate: true },
    err,
    h('div', { class: 'field' }, h('label', { text: 'اسم السيرفر' }), name),
    h('div', { class: 'row2' }, h('div', { class: 'field' }, h('label', { text: 'عنوان السيرفر (IP أو دومين)' }), host), h('div', { class: 'field' }, h('label', { text: 'المنفذ' }), port)),
    h('div', { class: 'field' }, h('label', { text: 'اسم البوت داخل اللعبة' }), user, h('span', { class: 'hint', text: '3–16 حرفًا إنجليزيًا أو أرقامًا أو _ . الدخول بوضع Offline (نسخ غير رسمية/سيرفرات Aternos).' })),
    h('div', { class: 'row2' }, h('div', { class: 'field' }, h('label', { text: 'إصدار اللعبة' }), ver), h('div', { class: 'field' }, h('label', { text: 'كلمة مرور البوت' }), pw)),
    rmPw && h('label', { class: 'check' }, rmPw, 'حذف كلمة المرور المحفوظة'),
    h('label', { class: 'check' }, afk, h('span', { text: 'منع الطرد بسبب الخمول (حركة بسيطة كل بضع ثوانٍ)' })),
    h('label', { class: 'check' }, rec, h('span', { text: 'إعادة الاتصال تلقائيًا عند الانقطاع' })),
    h('p', { class: 'hint', text: 'كلمة المرور (إن وُجدت) تُستخدم فقط لأوامر /login و/register التي يطلبها السيرفر، وتُحفظ مشفّرة على الخادم ولا تُعرض مجددًا.' }),
    h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: () => m.close(), text: 'إلغاء' }), submit));
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.hidden = true;
    let hostV = host.value.trim(), portV = Number(port.value);
    const mm = hostV.match(/^(?:[a-z]+:\/\/)?([^:/\s]+)(?::(\d{1,5}))?\/?$/i);
    if (mm) { hostV = mm[1]; if (mm[2]) portV = Number(mm[2]); }
    const body = { name: name.value, host: hostV, port: portV, username: user.value, version: ver.value, antiAfk: afk.checked, autoReconnect: rec.checked };
    if (pw.value) body.password = pw.value; if (rmPw && rmPw.checked && !pw.value) body.removePassword = true;
    withBusy(submit, async () => {
      try {
        const d = await api(editing ? `/api/servers/${existing.id}` : '/api/servers', { method: editing ? 'PATCH' : 'POST', body });
        m.close(); toast(editing ? 'تم حفظ التعديلات' : 'تمت الإضافة — البوت يحاول الدخول الآن');
        S.selectedId = d.server.id; await loadList(); select(d.server.id);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
    });
  });
  m = modal([h('h3', { text: editing ? 'تعديل السيرفر' : 'إضافة سيرفر' }), h('p', { class: 'sub', text: editing ? 'عدّل البيانات ثم احفظ. سيُعاد تشغيل البوت إن تغيّر العنوان أو الاسم.' : 'أدخل بيانات سيرفر حقيقي. لن يُعرض أي شيء إلا ما يردّ به السيرفر فعليًا.' }), form]);
  name.focus();
}

/* ---------- التحديث الدوري ---------- */
async function loadList() {
  const d = await api('/api/servers'); S.servers = d.servers; S.lastList = Date.now();
  if (!S.servers.find((x) => x.id === S.selectedId)) S.selectedId = S.servers[0] ? S.servers[0].id : null;
  renderList();
  if (!S.servers.length) return emptyState();
  if (S.refsFor !== S.selectedId) buildDetail();
}
async function poll(force) {
  if (!S.user) return; if (S.busy) { if (force) S.again = true; return; } if (document.hidden && !force) return;
  S.busy = true;
  try {
    if (force || Date.now() - S.lastList > 8000) { await loadList(); }
    if (S.selectedId) { const id = S.selectedId; const d = await api(`/api/servers/${id}`); if (id === S.selectedId) { const i = S.servers.findIndex((x) => x.id === id); if (i >= 0) { S.servers[i] = { ...d.server, runtime: { status: d.runtime.status } }; renderList(); } updateDetail(d); if ((d.ping.state === 'checking' || d.runtime.status === 'connecting') && !S.fast) S.fast = setTimeout(() => { S.fast = null; poll(true); }, 800); } }
  } catch (e) {
    if (e.status === 404) { S.selectedId = null; try { await loadList(); } catch { /* */ } }
    else if (!(e instanceof ApiError)) console.error('[ui] خطأ في التحديث:', e);
  } finally { S.busy = false; if (S.again) { S.again = false; poll(true); } }
}
function startPolling() { stopPolling(); S.tick = setInterval(() => poll(false), 3000); S.clock = setInterval(tickUptime, 1000); }
function stopPolling() { clearInterval(S.tick); clearInterval(S.clock); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) poll(true); });

/* ---------- البدء ---------- */
async function startApp() {
  renderShell(); startPolling();
  try { await loadList(); await poll(true); } catch (e) { toast(e.message, true); }
}
(async function init() {
  try {
    const d = await api('/api/session'); S.allowRegistration = d.allowRegistration; S.user = d.user;
    if (S.user) await startApp(); else renderAuth('login');
  } catch (e) {
    $root.replaceChildren(h('main', { class: 'auth' }, h('section', { class: 'auth-card' }, h('div', { class: 'alert err', text: e.message }), h('button', { class: 'btn primary block', type: 'button', onclick: () => location.reload(), text: 'إعادة المحاولة' }))));
  }
})();
