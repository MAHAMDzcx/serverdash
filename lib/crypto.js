'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// مفتاح التشفير لكلمات مرور البوتات (تُحفظ مشفّرة وليست نصًا صريحًا).
function loadKey() {
  if (process.env.SECRET_KEY) return crypto.createHash('sha256').update(process.env.SECRET_KEY).digest();
  const file = path.join(config.DATA_DIR, 'secret.key');
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  try { const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); if (k.length === 32) return k; } catch {}
  const k = crypto.randomBytes(32);
  fs.writeFileSync(file, k.toString('hex'), { mode: 0o600 });
  return k;
}
const KEY = loadKey();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
function decrypt(payload) {
  const [v, iv, tag, ct] = String(payload).split(':');
  if (v !== 'v1') throw new Error('bad format');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
module.exports = { encrypt, decrypt };
