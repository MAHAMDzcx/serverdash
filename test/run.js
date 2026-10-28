'use strict';
// اختبار شامل: يشغّل الخادم فعليًا + سيرفر ماينكرافت وهمي (للفحص) + mineflayer وهمي.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MC_PORT = 25990, APP_PORT = 3190, BASE = `http://127.0.0.1:${APP_PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vi = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
const pk = (id, p) => { const b = Buffer.concat([vi(id), p]); return Buffer.concat([vi(b.length), b]); };

// سيرفر ماينكرافت وهمي يتحدث بروتوكول Server List Ping
const mc = net.createServer((s) => {
  let buf = Buffer.alloc(0), n = 0;
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) { // نحلل الحزم
      let len = 0, sz = 0, b; do { if (sz >= buf.length) return; b = buf[sz]; len |= (b & 127) << (7 * sz); sz++; } while (b & 128);
      if (buf.length < sz + len) return;
      const body = buf.subarray(sz, sz + len); buf = buf.subarray(sz + len); n++;
      if (n === 2) { const j = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.20.4', protocol: 765 }, players: { online: 3, max: 20, sample: [{ name: 'Steve', id: 'x' }, { name: 'Alex', id: 'y' }] }, description: { text: '§aWelcome ', extra: [{ text: 'to Test' }] } })); s.write(pk(0, Buffer.concat([vi(j.length), j]))); }
      else if (n === 3) s.write(pk(1, body.subarray(1)));
    }
  });
  s.on('error', () => {});
});

async function api(p, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ServerDash', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data, setCookie: (res.headers.get('set-cookie') || '').split(';')[0], raw: res };
}

(async () => {
  await new Promise((r) => mc.listen(MC_PORT, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-'));
  const env = { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, ALLOW_PRIVATE_HOSTS: '1', SD_MINEFLAYER_PATH: path.join(__dirname, 'fake', 'mineflayer.js') };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(100); }

  console.log('\n— الملفات الثابتة والأمان');
  let r = await fetch(BASE + '/'); ok(r.status === 200 && (await r.text()).includes('ServerDash'), 'الصفحة الرئيسية تعمل');
  r = await fetch(BASE + '/app.js'); ok(r.status === 200 && /javascript/.test(r.headers.get('content-type')), 'app.js يُخدَّم');
  r = await fetch(BASE + '/..%2fserver.js'); ok([400, 403, 404].includes(r.status), 'منع الخروج من مجلد public');
  r = await fetch(BASE + '/%2e%2e/%2e%2e/etc/passwd.txt'); ok([400, 403, 404].includes(r.status), 'منع path traversal');
  r = await fetch(BASE + '/%2e%2e/%2e%2e/etc/passwd'); ok(!(await r.text()).includes('root:'), 'لا يُسرَّب ملف نظام');
  ok(!!(await fetch(BASE + '/')).headers.get('content-security-policy'), 'ترويسة CSP موجودة');

  console.log('\n— الحساب وتسجيل الدخول');
  r = await api('/api/servers'); ok(r.status === 401, 'API محمية بدون تسجيل دخول');
  r = await api('/api/session'); ok(r.status === 200 && r.data.user === null, 'الجلسة فارغة قبل الدخول');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'أحمد', email: 'a@test.com', password: '123' } }); ok(r.status === 400, 'رفض كلمة مرور قصيرة');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'أحمد', email: 'bad', password: '12345678' } }); ok(r.status === 400, 'رفض بريد غير صالح');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'أحمد', email: 'a@test.com', password: 'secret-pass-1' }, headers: { 'X-Requested-With': 'x' } }); ok(r.status === 403, 'رفض الطلب بدون ترويسة CSRF');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'أحمد', email: 'a@test.com', password: 'secret-pass-1' } });
  const ckA = r.setCookie; ok(r.status === 200 && ckA.startsWith('sd_session='), 'إنشاء حساب + كوكي جلسة');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'x2', email: 'A@test.com', password: 'secret-pass-1' } }); ok(r.status === 409, 'منع تكرار البريد');
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'a@test.com', password: 'wrong-pass' } }); ok(r.status === 401, 'رفض كلمة مرور خاطئة');
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'nobody@test.com', password: 'wrong-pass' } }); ok(r.status === 401 && r.data.error === 'البريد أو كلمة المرور غير صحيحة.', 'نفس رسالة الخطأ لمستخدم غير موجود');
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'a@test.com', password: 'secret-pass-1' } }); const cookie = r.setCookie; ok(r.status === 200 && cookie, 'تسجيل الدخول الصحيح');
  r = await api('/api/session', { cookie }); ok(r.data.user && r.data.user.email === 'a@test.com' && !('passHash' in r.data.user), 'الجلسة صالحة ولا تكشف كلمة المرور');
  const dbRaw = fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'); ok(!dbRaw.includes('secret-pass-1'), 'كلمة المرور غير مخزّنة كنص صريح');

  console.log('\n— إضافة سيرفر والتحقق من المدخلات');
  r = await api('/api/servers', { cookie }); ok(r.status === 200 && r.data.servers.length === 0, 'لا توجد سيرفرات وهمية في البداية');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'x', host: 'http://bad host', port: 25565, username: 'Bot1' } }); ok(r.status === 400, 'رفض عنوان غير صالح');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'x', host: '127.0.0.1', port: 70000, username: 'Bot1' } }); ok(r.status === 400, 'رفض منفذ غير صالح');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'x', host: '127.0.0.1', port: MC_PORT, username: 'ab' } }); ok(r.status === 400, 'رفض اسم بوت قصير');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'سيرفر الاختبار', host: '127.0.0.1', port: MC_PORT, username: 'TestBot', password: 'botpw123' } });
  ok(r.status === 201, 'إضافة سيرفر صحيح'); const id = r.data.server && r.data.server.id;
  ok(r.data.server && r.data.server.hasPassword === true && !JSON.stringify(r.data).includes('botpw123'), 'كلمة مرور البوت لا تُرجع للمتصفح');
  ok(!fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8').includes('botpw123') || (await sleep(500), !fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8').includes('botpw123')), 'كلمة مرور البوت مشفّرة في التخزين');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'dup', host: '127.0.0.1', port: MC_PORT, username: 'TestBot' } }); ok(r.status === 409, 'منع التكرار');

  console.log('\n— معلومات السيرفر الحقيقية ودخول البوت');
  await sleep(400);
  r = await api(`/api/servers/${id}`, { cookie }); await sleep(600); r = await api(`/api/servers/${id}`, { cookie });
  const d = r.data;
  ok(d.runtime.status === 'online', 'حالة البوت: online بعد حدث spawn');
  ok(d.ping.state === 'online' && d.ping.data.version.name === 'Paper 1.20.4', 'إصدار السيرفر من الفحص الحقيقي');
  ok(d.ping.data.players.online === 3 && d.ping.data.players.max === 20, 'عدد اللاعبين الحقيقي 3/20');
  ok(d.ping.data.motd === 'Welcome to Test', 'MOTD بدون رموز الألوان');
  ok(typeof d.ping.data.latency === 'number', 'زمن الاستجابة مقاس فعليًا');
  ok(d.runtime.live && d.runtime.live.health === 18 && d.runtime.live.food === 15 && d.runtime.live.gamemode === 'survival', 'بيانات البوت الحية (صحة/جوع/وضع)');
  ok(d.runtime.live.players.some((p) => p.name === 'Steve'), 'قائمة اللاعبين من البوت');
  ok(d.logs.some((l) => l.level === 'success' && /دخل البوت/.test(l.message)), 'السجل يحتوي دخول البوت');
  r = await api(`/api/servers/${id}/chat`, { method: 'POST', cookie, body: { message: 'مرحبا' } }); ok(r.status === 200, 'إرسال رسالة شات من البوت');
  r = await api(`/api/servers/${id}/chat`, { method: 'POST', cookie, body: { message: '' } }); ok(r.status === 400, 'رفض رسالة فارغة');

  console.log('\n— التحكم: إيقاف/تشغيل/تعديل');
  r = await api(`/api/servers/${id}/stop`, { method: 'POST', cookie }); ok(r.data.runtime.status === 'stopped', 'إيقاف البوت');
  r = await api(`/api/servers/${id}/chat`, { method: 'POST', cookie, body: { message: 'x' } }); ok(r.status === 409, 'الشات مرفوض والبوت متوقف');
  r = await api(`/api/servers/${id}/start`, { method: 'POST', cookie }); await sleep(500); r = await api(`/api/servers/${id}`, { cookie }); ok(r.data.runtime.status === 'online', 'إعادة تشغيل البوت تعمل');
  r = await api(`/api/servers/${id}`, { method: 'PATCH', cookie, body: { name: 'اسم جديد', antiAfk: false } }); ok(r.status === 200 && r.data.server.name === 'اسم جديد', 'تعديل السيرفر');
  r = await api(`/api/servers/${id}/restart`, { method: 'POST', cookie }); await sleep(500); r = await api(`/api/servers/${id}`, { cookie }); ok(r.data.runtime.status === 'online', 'restart يعمل');

  console.log('\n— حالات الخطأ');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'مطرود', host: '127.0.0.1', port: MC_PORT, username: 'KickMe' } }); const kid = r.data.server.id; await sleep(600);
  r = await api(`/api/servers/${kid}`, { cookie }); ok(r.data.runtime.status === 'error' && /القائمة البيضاء/.test(r.data.runtime.kicked || ''), 'الطرد بسبب whitelist يظهر بسببه ويتوقف دون حلقة إعادة');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'فاشل', host: '127.0.0.1', port: MC_PORT, username: 'ConnFail' } }); const fid = r.data.server.id; await sleep(600);
  r = await api(`/api/servers/${fid}`, { cookie }); ok(r.data.runtime.status === 'reconnecting' && /رفض السيرفر الاتصال/.test(r.data.runtime.lastError || ''), 'ECONNREFUSED برسالة عربية واضحة + إعادة اتصال مجدولة');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'مغلق', host: '127.0.0.1', port: 25991, username: 'Offline1', start: false } }); const oid = r.data.server.id; await sleep(500);
  r = await api(`/api/servers/${oid}`, { cookie }); await sleep(400); r = await api(`/api/servers/${oid}`, { cookie });
  ok(r.data.ping.state === 'offline' && /رفض السيرفر الاتصال/.test(r.data.ping.error), 'سيرفر مغلق يظهر "لا يستجيب" بدل بيانات مزيفة'); ok(r.data.ping.data === null, 'لا توجد بيانات مختلقة للسيرفر المغلق');
  r = await api('/api/servers', { method: 'POST', cookie, body: { name: 'ghost', host: 'no-such-host-zzz.invalid', port: 25565, username: 'Bot9', start: false } }); ok(r.status === 400 && /عنوان/.test(r.data.error), 'دومين غير موجود يعطي خطأ واضحًا');

  console.log('\n— عزل المستخدمين');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'سعد', email: 'b@test.com', password: 'other-pass-22' } }); const ckB = r.setCookie;
  r = await api('/api/servers', { cookie: ckB }); ok(r.data.servers.length === 0, 'المستخدم الثاني لا يرى سيرفرات الأول');
  for (const [m, p] of [['GET', ''], ['POST', '/start'], ['POST', '/stop'], ['DELETE', ''], ['PATCH', '']]) { r = await api(`/api/servers/${id}${p}`, { method: m, cookie: ckB, body: m === 'PATCH' ? { name: 'hack' } : undefined }); ok(r.status === 404, `المستخدم الثاني ممنوع: ${m} ${p || '/'}`); }
  r = await api(`/api/servers/${id}`, { cookie }); ok(r.data.server.name === 'اسم جديد', 'بيانات المستخدم الأول لم تتأثر');

  console.log('\n— الحذف والخروج وإعادة التشغيل');
  r = await api(`/api/servers/${oid}`, { method: 'DELETE', cookie }); ok(r.status === 200, 'حذف سيرفر');
  r = await api(`/api/servers/${oid}`, { cookie }); ok(r.status === 404, 'السيرفر المحذوف غير موجود');
  r = await api('/api/auth/logout', { method: 'POST', cookie }); r = await api('/api/servers', { cookie }); ok(r.status === 401, 'الخروج يُبطل الجلسة');
  r = await api('/api/nope'); ok(r.status === 404, 'مسار API غير موجود → 404 JSON');
  r = await fetch(BASE + '/api/servers', { method: 'POST', headers: { 'X-Requested-With': 'ServerDash', 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://evil.example' }, body: '{}' }); ok(r.status === 403 || r.status === 401, 'Origin غريب مرفوض');
  r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'X-Requested-With': 'ServerDash', 'Content-Type': 'application/json' }, body: '{bad json' }); ok(r.status === 400, 'JSON تالف → 400 وليس انهيار');

  console.log('\n— استمرار البيانات بعد إعادة التشغيل');
  child.kill('SIGTERM'); await sleep(800);
  const child2 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child2.stderr.on('data', (x) => { stderr += x; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(100); }
  r = await api('/api/auth/login', { method: 'POST', body: { email: 'a@test.com', password: 'secret-pass-1' } }); const ck2 = r.setCookie; ok(r.status === 200, 'الحساب محفوظ بعد إعادة التشغيل');
  await sleep(1500); r = await api(`/api/servers/${id}`, { cookie: ck2 }); ok(r.data.server.name === 'اسم جديد' && r.data.runtime.status === 'online', 'السيرفر محفوظ والبوت يستأنف تلقائيًا');
  child2.kill('SIGTERM'); await sleep(500); mc.close();

  console.log('\n— أخطاء الخادم');
  ok(!/Error|TypeError|ReferenceError/.test(stderr), 'لا توجد أخطاء غير معالجة في stderr' + (stderr ? '\n' + stderr.slice(0, 600) : ''));
  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
