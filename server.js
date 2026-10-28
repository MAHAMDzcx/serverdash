'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const db = require('./lib/db');
const auth = require('./lib/auth');
const bots = require('./lib/bots');
const { encrypt } = require('./lib/crypto');
const { ping } = require('./lib/mcping');
const { HttpError } = require('./lib/errors');
const { friendlyNetError, assertPublicHost } = require('./lib/util');

const SESSION_COOKIE = 'sd_session';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };

/* ---------- أدوات مساعدة ---------- */
function clientIp(req) {
  if (config.TRUST_PROXY) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || 'unknown';
}
function isHttps(req) { return !!req.socket.encrypted || (config.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'); }
function parseCookies(req) {
  const out = {}; for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return out;
}
function cookieHeader(req, value, maxAge) {
  const secure = config.COOKIE_SECURE === 'auto' ? isHttps(req) : config.COOKIE_SECURE;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'");
}
function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...extra });
  res.end(body);
}
function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { tooBig = true; return; } chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'حجم الطلب كبير جدًا.'));
      if (!size) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; resolve(v); }
      catch { reject(new HttpError(400, 'صيغة الطلب غير صحيحة.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'تعذّرت قراءة الطلب.')));
  });
}

/* ---------- التحقق من المدخلات ---------- */
const str = (v) => (typeof v === 'string' ? v.trim() : '');
function validateServer(b) {
  const name = str(b.name), host = str(b.host).toLowerCase(), username = str(b.username), version = str(b.version);
  const port = Number(b.port);
  if (!name || name.length > 60) throw new HttpError(400, 'اكتب اسمًا للسيرفر (حتى 60 حرفًا).');
  if (!host || host.length > 253 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) throw new HttpError(400, 'عنوان السيرفر غير صالح. اكتب الدومين أو IP فقط بدون http:// وبدون المنفذ.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'المنفذ يجب أن يكون رقمًا بين 1 و65535.');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new HttpError(400, 'اسم البوت يجب أن يكون 3–16 حرفًا إنجليزيًا أو رقمًا أو _ فقط.');
  if (version && !/^1\.\d{1,2}(\.\d{1,2})?$/.test(version)) throw new HttpError(400, 'صيغة الإصدار غير صحيحة (مثال: 1.20.4) أو اتركه فارغًا للكشف التلقائي.');
  if (typeof b.password === 'string' && b.password.length > 128) throw new HttpError(400, 'كلمة مرور البوت طويلة جدًا.');
  return { name, host, port, username, version: version || null, antiAfk: b.antiAfk !== false, autoReconnect: b.autoReconnect !== false };
}
const pub = (s) => ({ id: s.id, name: s.name, host: s.host, port: s.port, username: s.username, version: s.version || null, antiAfk: !!s.antiAfk, autoReconnect: !!s.autoReconnect, hasPassword: !!s.passwordEnc, createdAt: s.createdAt });
const userServers = (uid) => Object.values(db.servers).filter((s) => s.userId === uid);
function owned(ctx) {
  const s = db.servers[ctx.params.id];
  if (!s || s.userId !== ctx.user.id) throw new HttpError(404, 'السيرفر غير موجود ضمن حسابك.');
  return s;
}
function adminOnly(ctx) {
  if (!ctx.user || ctx.user.role !== 'admin') throw new HttpError(403, 'هذه الصفحة مخصصة للمدير فقط.', 'ADMIN_REQUIRED');
}

/* ---------- فحص حالة السيرفر (مخزّن مؤقتًا) ---------- */
const pingCache = new Map();
function refreshPing(s, maxAge = 8000) {
  let c = pingCache.get(s.id);
  if (!c) { c = { at: 0, inflight: false, result: null, key: '' }; pingCache.set(s.id, c); }
  const key = `${s.host}:${s.port}`;
  if (c.key !== key) { c.key = key; c.result = null; c.at = 0; }
  if (!c.inflight && Date.now() - c.at >= maxAge) {
    c.inflight = true;
    ping(s.host, s.port).then(
      (data) => { c.result = { ok: true, data, at: Date.now() }; },
      (err) => { c.result = { ok: false, error: friendlyNetError(err), at: Date.now() }; },
    ).finally(() => { c.inflight = false; c.at = Date.now(); });
  }
  return c.result ? { state: c.result.ok ? 'online' : 'offline', checkedAt: c.result.at, data: c.result.data || null, error: c.result.error || null, checking: c.inflight } : { state: 'checking', checkedAt: null, data: null, error: null, checking: true };
}

/* ---------- المسارات ---------- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, auth: opts.auth !== false });

route('GET', '/healthz', async () => ({ ok: true }), { auth: false });

route('GET', '/api/session', async (ctx) => ({ user: ctx.user ? { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role || 'user' } : null, allowRegistration: config.ALLOW_REGISTRATION }), { auth: false });

route('POST', '/api/auth/register', async (ctx) => {
  if (!config.ALLOW_REGISTRATION) throw new HttpError(403, 'التسجيل مغلق في هذه اللوحة.');
  const wait = auth.rateLimit(`reg:${ctx.ip}`, 10, 3600000);
  if (wait) throw new HttpError(429, `محاولات تسجيل كثيرة. حاول بعد ${wait} ثانية.`);
  const name = str(ctx.body.name), email = str(ctx.body.email).toLowerCase(), password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'الاسم يجب أن يكون بين 2 و40 حرفًا.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw new HttpError(400, 'البريد الإلكتروني غير صالح.');
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
  if (Object.values(db.users).some((u) => u.email === email)) throw new HttpError(409, 'هذا البريد مسجّل مسبقًا. جرّب تسجيل الدخول.');
  const user = { id: crypto.randomUUID(), name, email, role: 'user', passHash: await auth.hashPassword(password), createdAt: Date.now() };
  db.users[user.id] = user; db.save();
  const token = auth.createSession(user.id);
  ctx.setCookie = cookieHeader(ctx.req, token, config.SESSION_DAYS * 86400);
  return { user: { id: user.id, name, email, role: user.role || 'user' } };
}, { auth: false });

route('POST', '/api/auth/login', async (ctx) => {
  const email = str(ctx.body.email).toLowerCase(), password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const key = `login:${ctx.ip}:${email}`;
  const wait = auth.rateLimit(key, 8, 600000);
  if (wait) throw new HttpError(429, `محاولات دخول كثيرة. حاول بعد ${Math.ceil(wait / 60)} دقيقة.`);
  if (!email || !password) throw new HttpError(400, 'اكتب البريد وكلمة المرور.');
  const user = Object.values(db.users).find((u) => u.email === email);
  const ok = user ? await auth.verifyPassword(password, user.passHash) : await auth.fakeVerify(password);
  if (!ok) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة.');
  auth.rateReset(key);
  const token = auth.createSession(user.id);
  ctx.setCookie = cookieHeader(ctx.req, token, config.SESSION_DAYS * 86400);
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role || 'user' } };
}, { auth: false });

route('POST', '/api/auth/logout', async (ctx) => {
  auth.destroySession(parseCookies(ctx.req)[SESSION_COOKIE]);
  ctx.setCookie = cookieHeader(ctx.req, '', 0);
  return { ok: true };
}, { auth: false });

route('GET', '/api/admin/overview', async (ctx) => {
  adminOnly(ctx);
  const users = Object.values(db.users).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role || 'user', createdAt: u.createdAt, servers: userServers(u.id).length }));
  const servers = Object.values(db.servers).map((s) => ({ id: s.id, name: s.name, host: s.host, port: s.port, username: s.username, userId: s.userId, status: bots.state(s.id).status, createdAt: s.createdAt }));
  return { users, servers };
});

route('GET', '/api/servers', async (ctx) => ({
  servers: userServers(ctx.user.id).sort((a, b) => a.createdAt - b.createdAt).map((s) => { const st = bots.state(s.id); return { ...pub(s), runtime: { status: st.status } }; }),
}));

route('POST', '/api/servers', async (ctx) => {
  const input = validateServer(ctx.body);
  if (userServers(ctx.user.id).length >= config.MAX_SERVERS) throw new HttpError(400, `وصلت للحد الأقصى (${config.MAX_SERVERS} سيرفرات).`);
  if (userServers(ctx.user.id).some((s) => s.host === input.host && s.port === input.port && s.username === input.username)) throw new HttpError(409, 'هذا السيرفر بنفس اسم البوت مضاف مسبقًا.');
  try { await assertPublicHost(input.host, config.ALLOW_PRIVATE); } catch (e) { throw new HttpError(400, e.message, e.code); }
  const id = crypto.randomUUID();
  const rec = { id, userId: ctx.user.id, ...input, passwordEnc: str(ctx.body.password) ? encrypt(ctx.body.password) : null, desired: false, createdAt: Date.now() };
  db.servers[id] = rec; db.save();
  db.addLog(id, 'info', 'تمت إضافة السيرفر.');
  refreshPing(rec, 0);
  if (ctx.body.start !== false) await bots.start(rec).catch((e) => db.addLog(id, 'error', e.message));
  ctx.status = 201;
  return { server: { ...pub(rec), runtime: bots.state(id) } };
});

route('GET', '/api/servers/:id', async (ctx) => {
  const s = owned(ctx);
  return { server: pub(s), runtime: bots.state(s.id), ping: refreshPing(s), logs: db.getLogs(s.id, 120), serverTime: Date.now() };
});

route('PATCH', '/api/servers/:id', async (ctx) => {
  const s = owned(ctx);
  const merged = validateServer({ ...pub(s), ...ctx.body });
  if (userServers(ctx.user.id).some((o) => o.id !== s.id && o.host === merged.host && o.port === merged.port && o.username === merged.username)) throw new HttpError(409, 'يوجد سيرفر آخر بنفس البيانات.');
  try { await assertPublicHost(merged.host, config.ALLOW_PRIVATE); } catch (e) { throw new HttpError(400, e.message, e.code); }
  const connChanged = ['host', 'port', 'username', 'version'].some((k) => s[k] !== merged[k]);
  let pwChanged = false;
  if (ctx.body.removePassword === true) { s.passwordEnc = null; pwChanged = true; }
  else if (str(ctx.body.password)) { s.passwordEnc = encrypt(ctx.body.password); pwChanged = true; }
  Object.assign(s, merged); db.save();
  pingCache.delete(s.id);
  const st = bots.state(s.id).status;
  if ((connChanged || pwChanged) && ['connecting', 'online', 'reconnecting'].includes(st)) { db.addLog(s.id, 'info', 'تم تعديل الإعدادات — إعادة تشغيل البوت.'); await bots.restart(s).catch((e) => db.addLog(s.id, 'error', e.message)); }
  else db.addLog(s.id, 'info', 'تم تحديث إعدادات السيرفر.');
  return { server: { ...pub(s), runtime: bots.state(s.id) } };
});

route('POST', '/api/servers/:id/start', async (ctx) => { const s = owned(ctx); return { runtime: await bots.start(s) }; });
route('POST', '/api/servers/:id/stop', async (ctx) => { const s = owned(ctx); return { runtime: bots.stop(s.id) }; });
route('POST', '/api/servers/:id/restart', async (ctx) => { const s = owned(ctx); return { runtime: await bots.restart(s) }; });
route('POST', '/api/servers/:id/chat', async (ctx) => {
  const s = owned(ctx); const msg = typeof ctx.body.message === 'string' ? ctx.body.message.replace(/[\r\n]+/g, ' ').trim() : '';
  if (!msg) throw new HttpError(400, 'اكتب رسالة أولًا.');
  if (msg.length > 250) throw new HttpError(400, 'الرسالة طويلة (الحد 250 حرفًا).');
  const wait = auth.rateLimit(`chat:${s.id}`, 15, 30000);
  if (wait) throw new HttpError(429, 'أرسلت رسائل كثيرة بسرعة. انتظر قليلًا.');
  bots.chat(s.id, msg); return { ok: true };
});
route('DELETE', '/api/servers/:id', async (ctx) => {
  const s = owned(ctx); bots.remove(s.id); delete db.servers[s.id]; db.deleteLogs(s.id); pingCache.delete(s.id); db.save(); return { ok: true };
});

/* ---------- المعالجة ---------- */
async function handleApi(req, res, url) {
  securityHeaders(res);
  const byPath = routes.filter((r) => r.re.test(url.pathname));
  if (!byPath.length) throw new HttpError(404, 'المسار غير موجود.');
  const route_ = byPath.find((r) => r.method === req.method);
  if (!route_) throw new HttpError(405, 'الطريقة غير مسموحة.');
  const ctx = { req, res, ip: clientIp(req), params: route_.re.exec(url.pathname).groups || {}, body: {}, user: null, status: 200, setCookie: null };
  if (req.method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'ServerDash') throw new HttpError(403, 'طلب غير مصرّح به.');
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        const originHost = new URL(origin).host;
        const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
        ok = [req.headers.host, forwardedHost].filter(Boolean).includes(originHost);
        if (!ok && config.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') ok = true;
      } catch { /* */ }
      if (!ok) throw new HttpError(403, 'مصدر الطلب غير مسموح.');
    }
    ctx.body = await readBody(req);
  }
  ctx.user = auth.getSessionUser(parseCookies(req)[SESSION_COOKIE]);
  if (route_.auth && !ctx.user) throw new HttpError(401, 'انتهت الجلسة. سجّل الدخول من جديد.', 'AUTH_REQUIRED');
  const result = await route_.handler(ctx);
  sendJson(res, ctx.status, result, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
}

async function serveStatic(req, res, url) {
  securityHeaders(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  else if (rel === '/admin') rel = '/admin.html';
  else if (!path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(config.PUBLIC_DIR, rel));
  if (!file.startsWith(config.PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.promises.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('غير موجود'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, code: e.code });
    console.error('[server] خطأ غير متوقع:', e);
    sendJson(res, 500, { error: 'حدث خطأ داخلي غير متوقع. حاول مرة أخرى.' });
  }
});
server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

function shutdown() {
  console.log('إيقاف التشغيل…'); bots.shutdownAll(); db.flushAll();
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2500).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `المنفذ ${config.PORT} مستخدم. شغّل مع PORT=رقم_آخر` : e); process.exit(1); });
server.listen(config.PORT, config.HOST, () => {
  console.log(`ServerDash يعمل على http://localhost:${config.PORT}`);
  auth.ensureAdmin().then((ok) => { if (ok) console.log('تم تجهيز حساب المدير.'); }).catch((e) => console.error('[admin] تعذّر تجهيز الحساب:', e.message));
  auth.cleanupSessions(); setInterval(auth.cleanupSessions, 3600000).unref();
  let i = 0;
  for (const s of Object.values(db.servers)) if (s.desired) setTimeout(() => bots.start(s).catch((e) => db.addLog(s.id, 'error', e.message)), 1500 * i++);
});
