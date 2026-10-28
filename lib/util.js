'use strict';
const net = require('net');
const dns = require('dns').promises;

const stripColors = (s) => String(s).replace(/§[0-9a-fk-orx]/gi, '');

function nbtSimplify(n) {
  if (!n || typeof n !== 'object' || !('type' in n) || !('value' in n)) return n;
  const { type, value } = n;
  if (type === 'compound') { const o = {}; for (const k of Object.keys(value || {})) o[k] = nbtSimplify(value[k]); return o; }
  if (type === 'list') {
    const inner = value && value.value;
    if (!Array.isArray(inner)) return [];
    return inner.map((v) => (value.type === 'compound' || value.type === 'list' ? nbtSimplify({ type: value.type, value: v }) : v));
  }
  return value;
}

// تحويل رسائل Minecraft (JSON / NBT / نص) إلى نص عادي.
function flattenChat(x, depth = 0) {
  if (x == null || depth > 12) return '';
  if (typeof x === 'string') {
    const t = x.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return flattenChat(JSON.parse(t), depth + 1); } catch { /* نص عادي */ }
    }
    return x;
  }
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  if (Array.isArray(x)) return x.map((i) => flattenChat(i, depth + 1)).join('');
  if (typeof x === 'object') {
    if (x.type === 'compound' && x.value) return flattenChat(nbtSimplify(x), depth + 1);
    let out = '';
    if (x.text != null) out += flattenChat(x.text, depth + 1);
    else if (x.translate != null) {
      out += String(x.translate);
      if (Array.isArray(x.with) && x.with.length) out += ' ' + x.with.map((w) => flattenChat(w, depth + 1)).join(' ');
    }
    if (Array.isArray(x.extra)) out += x.extra.map((e) => flattenChat(e, depth + 1)).join('');
    return out;
  }
  return '';
}
const cleanText = (x) => stripColors(flattenChat(x)).replace(/\s+/g, ' ').trim();

const KICK_HINTS = [
  [/not_whitelisted|whitelist/i, 'البوت غير مضاف إلى القائمة البيضاء (whitelist) في السيرفر'],
  [/banned|ban\b/i, 'البوت محظور (Ban) من السيرفر'],
  [/duplicate_login|already (is )?connected|already online/i, 'هذا الاسم متصل بالسيرفر مسبقًا'],
  [/server_full|server is full|\bfull\b/i, 'السيرفر ممتلئ'],
  [/outdated_server|outdated_client|incompatible|unsupported|protocol/i, 'عدم توافق في إصدار اللعبة — حدّد إصدار السيرفر يدويًا في إعدادات السيرفر'],
  [/timeout|timed out/i, 'انتهت مهلة الاتصال'],
  [/spam/i, 'تم الطرد بسبب السبام'],
  [/flying|fly/i, 'تم الطرد بسبب الطيران'],
  [/offline|starting|not running|stopped/i, 'يبدو أن السيرفر مغلق أو قيد التشغيل'],
];
function kickHint(text) { for (const [re, msg] of KICK_HINTS) if (re.test(text)) return msg; return null; }

function friendlyNetError(err) {
  const code = err && err.code;
  const raw = String((err && err.message) || err || '').replace(/\s+/g, ' ').slice(0, 200);
  const map = {
    ECONNREFUSED: 'رفض السيرفر الاتصال — غالبًا السيرفر مغلق أو المنفذ غير صحيح',
    ENOTFOUND: 'لم يتم العثور على عنوان السيرفر — تحقق من كتابة العنوان',
    EAI_AGAIN: 'تعذّر الوصول إلى خادم DNS — تحقق من اتصال الإنترنت',
    ETIMEDOUT: 'انتهت مهلة الاتصال بالسيرفر — قد يكون مغلقًا أو محجوبًا بجدار ناري',
    ESOCKETTIMEDOUT: 'انتهت مهلة الاتصال بالسيرفر',
    ECONNRESET: 'قطع السيرفر الاتصال بشكل مفاجئ',
    EPIPE: 'انقطع الاتصال بالسيرفر',
    EHOSTUNREACH: 'تعذّر الوصول إلى السيرفر (لا يوجد مسار شبكة)',
    ENETUNREACH: 'الشبكة غير متاحة من جهاز التشغيل',
    EPROTO: 'استجابة غير متوقعة من السيرفر (ليس سيرفر Minecraft؟)',
  };
  if (code && map[code]) return map[code];
  if (/timed? ?out/i.test(raw)) return 'انتهت مهلة الاتصال بالسيرفر';
  if (/not a minecraft|invalid (status|response)|unexpected/i.test(raw)) return 'ردّ العنوان لكنه لا يبدو سيرفر Minecraft';
  return raw ? `خطأ في الاتصال: ${raw}` : 'خطأ غير معروف في الاتصال';
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) { const v4 = l.slice(7); if (net.isIPv4(v4)) return isPrivateAddress(v4); return true; }
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(l);
  }
  return true;
}

async function assertPublicHost(host, allowPrivate) {
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await dns.lookup(host, { all: true }); }
    catch (e) { const err = new Error(friendlyNetError(e)); err.code = e.code || 'ENOTFOUND'; throw err; }
  }
  if (!allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) {
    const err = new Error('هذا العنوان يشير إلى شبكة محلية/خاصة وهو غير مسموح في هذه النسخة. (للسماح به شغّل التطبيق مع ALLOW_PRIVATE_HOSTS=1)');
    err.code = 'PRIVATE_HOST'; throw err;
  }
}

module.exports = { stripColors, flattenChat, cleanText, kickHint, friendlyNetError, isPrivateAddress, assertPublicHost };
