'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const config = require('./config');
const scrypt = promisify(crypto.scrypt);

const N = 16384, R = 8, P = 1, KEYLEN = 64;
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}
const DUMMY = hashPassword('dummy-password-for-timing');
async function ensureAdmin() {
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!password) return false;
  const email = String(process.env.ADMIN_EMAIL || 'admin@gamil.com').trim().toLowerCase();
  let user = Object.values(db.users).find((u) => u.email === email);
  if (!user) {
    user = { id: crypto.randomUUID(), name: 'المدير', email, role: 'admin', passHash: await hashPassword(password), createdAt: Date.now() };
    db.users[user.id] = user;
  } else {
    user.name = user.name || 'المدير';
    user.role = 'admin';
    user.passHash = await hashPassword(password);
  }
  db.save();
  return true;
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const h = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(h, expected);
  } catch { return false; }
}
async function fakeVerify(pw) { await verifyPassword(pw, await DUMMY); return false; }

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(token)] = { userId, expires: Date.now() + config.SESSION_DAYS * 86400000 };
  db.save();
  return token;
}
function getSessionUser(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = db.sessions[sha(token)];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.sessions[sha(token)]; db.save(); return null; }
  return db.users[s.userId] || null;
}
function destroySession(token) { if (token) { delete db.sessions[sha(token)]; db.save(); } }
function cleanupSessions() {
  const now = Date.now(); let changed = false;
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].expires < now) { delete db.sessions[k]; changed = true; }
  if (changed) db.save();
}

// محدّد معدّل بسيط في الذاكرة
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) b = { n: 0, reset: now + windowMs };
  b.n++; buckets.set(key, b);
  return b.n > max ? Math.ceil((b.reset - now) / 1000) : 0;
}
function rateReset(key) { buckets.delete(key); }
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 600000).unref();

module.exports = { hashPassword, verifyPassword, fakeVerify, ensureAdmin, createSession, getSessionUser, destroySession, cleanupSessions, rateLimit, rateReset };
