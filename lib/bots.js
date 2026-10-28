'use strict';
const db = require('./db');
const config = require('./config');
const { decrypt } = require('./crypto');
const { HttpError } = require('./errors');
const { cleanText, kickHint, friendlyNetError, assertPublicHost } = require('./util');

const MAX_ATTEMPTS = 40;
const CONNECT_TIMEOUT = 45000;

class BotManager {
  constructor() { this.entries = new Map(); }

  _get(server) {
    let e = this.entries.get(server.id);
    if (!e) { e = { id: server.id, server, status: 'stopped', bot: null, gen: 0, attempt: 0, timers: new Set(), intervals: new Set() }; this.entries.set(server.id, e); }
    e.server = server; return e;
  }
  _log(e, level, msg) { db.addLog(e.id, level, msg); }
  _clearTimers(e) {
    for (const t of e.timers) clearTimeout(t); e.timers.clear();
    for (const t of e.intervals) clearInterval(t); e.intervals.clear();
    e.nextRetryAt = null;
  }
  _setTimer(e, fn, ms) { const t = setTimeout(() => { e.timers.delete(t); try { fn(); } catch (err) { console.error('[bot] timer error', err); } }, ms); e.timers.add(t); return t; }

  async start(server) {
    await assertPublicHost(server.host, config.ALLOW_PRIVATE).catch((err) => { throw new HttpError(400, err.message, err.code); });
    const e = this._get(server);
    if (['connecting', 'online', 'reconnecting'].includes(e.status)) return this.state(server.id);
    e.attempt = 0; e.noRetry = false; e.lastError = null; e.kicked = null; e.manualStop = false;
    server.desired = true; db.save();
    this._connect(e);
    return this.state(server.id);
  }

  async restart(server) { this.stop(server.id, true); return this.start(server); }

  stop(id, silent = false) {
    const e = this.entries.get(id);
    if (!e) return this.state(id);
    const server = db.servers[id];
    if (server) { server.desired = false; db.save(); }
    e.manualStop = true; e.gen++; this._clearTimers(e);
    const bot = e.bot; e.bot = null; e.spawned = false;
    if (bot) {
      try { bot.quit('ServerDash'); } catch { /* ignore */ }
      setTimeout(() => { try { bot.end(); } catch { /* ignore */ } }, 1500).unref();
    }
    if (e.status !== 'stopped' && !silent) this._log(e, 'info', 'تم إيقاف البوت.');
    e.status = 'stopped'; e.lastError = null; e.attempt = 0;
    return this.state(id);
  }

  remove(id) { this.stop(id, true); this.entries.delete(id); }

  shutdownAll() { for (const e of this.entries.values()) { e.gen++; this._clearTimers(e); try { if (e.bot) e.bot.quit('ServerDash shutdown'); } catch { /* ignore */ } } }

  _connect(e) {
    this._clearTimers(e);
    const s = e.server;
    e.status = e.attempt > 0 ? 'reconnecting' : 'connecting';
    e.since = Date.now(); e.spawned = false; e.kickedThisRound = false;

    let mineflayer;
    try { mineflayer = require(process.env.SD_MINEFLAYER_PATH || 'mineflayer'); }
    catch { return this._giveUp(e, 'حزمة mineflayer غير مثبتة على جهاز التشغيل. نفّذ الأمر: npm install'); }

    let password = null;
    if (s.passwordEnc) { try { password = decrypt(s.passwordEnc); } catch { this._log(e, 'warn', 'تعذّر فك تشفير كلمة مرور البوت؛ سيُتجاهل أمر تسجيل الدخول.'); } }

    this._log(e, 'info', `محاولة دخول إلى ${s.host}:${s.port} باسم ${s.username}${e.attempt ? ` (المحاولة ${e.attempt + 1})` : ''}…`);

    const gen = ++e.gen;
    let bot;
    try {
      bot = mineflayer.createBot({ host: s.host, port: s.port, username: s.username, auth: 'offline', ...(s.version ? { version: s.version } : {}), checkTimeoutInterval: 60000, hideErrors: true });
    } catch (err) {
      e.lastError = friendlyNetError(err); this._log(e, 'error', e.lastError);
      return this._scheduleRetry(e);
    }
    e.bot = bot;
    const live = () => e.gen === gen && e.bot === bot;
    let lastAuthSent = 0, chatBurst = { t: 0, n: 0 };

    this._setTimer(e, () => { if (live() && !e.spawned) { e.lastError = 'انتهت مهلة الدخول (لم يكتمل دخول البوت للعالم).'; this._log(e, 'error', e.lastError); try { bot.end(); } catch { /* */ } } }, CONNECT_TIMEOUT);

    bot.on('login', () => { if (live()) this._log(e, 'info', 'قبل السيرفر الاتصال (login) — بانتظار دخول العالم…'); });

    bot.on('spawn', () => {
      if (!live() || e.spawned) return;
      e.spawned = true; e.status = 'online'; e.attempt = 0; e.joinedAt = Date.now(); e.lastError = null; e.kicked = null;
      this._clearTimers(e);
      this._log(e, 'success', `دخل البوت ${s.username} إلى السيرفر فعليًا${bot.version ? ` (إصدار ${bot.version})` : ''}.`);
      if (s.antiAfk) {
        const iv = setInterval(() => {
          if (!live()) return;
          try { bot.setControlState('jump', true); setTimeout(() => { try { bot.setControlState('jump', false); } catch { /* */ } }, 300); bot.look((bot.entity.yaw || 0) + (Math.random() - 0.5), 0, true); } catch { /* */ }
        }, 25000);
        e.intervals.add(iv);
      }
    });

    bot.on('messagestr', (msg) => {
      if (!live()) return;
      const text = String(msg || '').replace(/\s+/g, ' ').trim(); if (!text) return;
      if (password && Date.now() - lastAuthSent > 10000) {
        if (/\/register/i.test(text)) { lastAuthSent = Date.now(); try { bot.chat(`/register ${password} ${password}`); this._log(e, 'info', 'طلب السيرفر التسجيل — تم إرسال أمر /register.'); } catch { /* */ } return; }
        if (/\/login|\/l\b/i.test(text)) { lastAuthSent = Date.now(); try { bot.chat(`/login ${password}`); this._log(e, 'info', 'طلب السيرفر تسجيل الدخول — تم إرسال أمر /login.'); } catch { /* */ } return; }
      }
      const now = Date.now(); if (now - chatBurst.t > 10000) chatBurst = { t: now, n: 0 };
      if (++chatBurst.n <= 15) this._log(e, 'chat', text.slice(0, 220));
    });

    bot.on('playerJoined', (p) => { if (live() && e.joinedAt && Date.now() - e.joinedAt > 4000 && p && p.username !== s.username) this._log(e, 'info', `دخل اللاعب ${p.username}`); });
    bot.on('playerLeft', (p) => { if (live() && p && p.username !== s.username) this._log(e, 'info', `خرج اللاعب ${p.username}`); });
    bot.on('death', () => { if (live()) this._log(e, 'warn', 'مات البوت وسيعيد الظهور تلقائيًا.'); });

    bot.on('kicked', (reason) => {
      if (!live()) return;
      let text = '';
      try { text = cleanText(reason); } catch { /* */ }
      if (!text) { try { text = cleanText(JSON.stringify(reason)); } catch { text = 'سبب غير معروف'; } }
      const hint = kickHint(text);
      e.kicked = hint ? `${hint} — «${text.slice(0, 160)}»` : text.slice(0, 200); e.kickedThisRound = true;
      this._log(e, 'error', `تم طرد البوت: ${e.kicked}`);
      if (/not_whitelisted|whitelist|banned|\bban\b/i.test(text)) e.noRetry = true;
    });

    bot.on('error', (err) => {
      if (!live()) return;
      e.lastError = friendlyNetError(err); this._log(e, 'error', e.lastError);
    });

    bot.on('end', (reason) => {
      if (!live()) return;
      e.bot = null; e.spawned = false; this._clearTimers(e);
      if (e.manualStop) { e.status = 'stopped'; return; }
      if (!e.kickedThisRound && !e.lastError) this._log(e, 'warn', `انقطع الاتصال بالسيرفر${reason ? ` (${String(reason).slice(0, 120)})` : ''}.`);
      else if (!e.kickedThisRound) this._log(e, 'warn', 'انتهى الاتصال بالسيرفر.');
      this._scheduleRetry(e);
    });
  }

  _scheduleRetry(e) {
    const s = e.server;
    if (e.noRetry) return this._giveUp(e, e.kicked ? `توقفت المحاولات: ${e.kicked}` : 'توقفت المحاولات تلقائيًا.');
    if (!s.autoReconnect) { e.status = e.lastError || e.kicked ? 'error' : 'stopped'; s.desired = false; db.save(); return; }
    if (e.attempt >= MAX_ATTEMPTS) return this._giveUp(e, `توقفت إعادة المحاولة بعد ${MAX_ATTEMPTS} محاولة فاشلة.`);
    const delay = Math.min(5000 * 2 ** Math.min(e.attempt, 4), 60000);
    e.attempt++; e.status = 'reconnecting'; e.nextRetryAt = Date.now() + delay;
    this._log(e, 'info', `إعادة المحاولة بعد ${Math.round(delay / 1000)} ثانية…`);
    this._setTimer(e, () => { if (!e.manualStop && e.status === 'reconnecting') this._connect(e); }, delay);
  }

  _giveUp(e, msg) {
    this._clearTimers(e); e.gen++; e.bot = null; e.status = 'error'; e.lastError = e.lastError || msg;
    this._log(e, 'error', msg); e.server.desired = false; db.save();
  }

  chat(id, message) {
    const e = this.entries.get(id);
    if (!e || e.status !== 'online' || !e.bot) throw new HttpError(409, 'البوت ليس داخل السيرفر حاليًا.');
    try { e.bot.chat(message); } catch (err) { throw new HttpError(500, 'تعذّر إرسال الرسالة.'); }
    this._log(e, 'chat', `[أنت] ${message}`);
  }

  state(id) {
    const e = this.entries.get(id);
    if (!e) return { status: 'stopped', attempt: 0 };
    const out = { status: e.status, attempt: e.attempt, lastError: e.lastError || null, kicked: e.kicked || null, nextRetryInMs: e.nextRetryAt ? Math.max(0, e.nextRetryAt - Date.now()) : null };
    if (e.status === 'online' && e.bot) {
      try {
        const b = e.bot, pos = b.entity && b.entity.position;
        out.live = {
          version: b.version || null,
          position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
          health: typeof b.health === 'number' ? b.health : null,
          food: typeof b.food === 'number' ? b.food : null,
          gamemode: (b.game && b.game.gameMode) || null,
          dimension: (b.game && b.game.dimension) || null,
          difficulty: (b.game && b.game.difficulty) || null,
          timeOfDay: b.time && typeof b.time.timeOfDay === 'number' ? b.time.timeOfDay : null,
          ping: b.player && typeof b.player.ping === 'number' ? b.player.ping : null,
          uptimeMs: e.joinedAt ? Date.now() - e.joinedAt : 0,
          players: Object.values(b.players || {}).map((p) => ({ name: p.username, ping: typeof p.ping === 'number' ? p.ping : null })).sort((a, c) => a.name.localeCompare(c.name)),
        };
      } catch { /* حالة غير مكتملة */ }
    }
    return out;
  }
}
module.exports = new BotManager();
