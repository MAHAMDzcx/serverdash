'use strict';
const net = require('net');
const dns = require('dns').promises;
const config = require('./config');
const { cleanText, assertPublicHost } = require('./util');

// فحص حالة السيرفر عبر بروتوكول Server List Ping الرسمي (بدون دخول البوت).
const writeVarInt = (n) => { const out = []; n >>>= 0; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
function readVarInt(buf, off = 0) {
  let v = 0, size = 0, b;
  do {
    if (off + size >= buf.length) return null;
    if (size >= 5) throw new Error('VarInt too long');
    b = buf[off + size]; v |= (b & 0x7f) << (7 * size); size++;
  } while (b & 0x80);
  return { value: v, size };
}
const packet = (id, payload) => { const body = Buffer.concat([writeVarInt(id), payload]); return Buffer.concat([writeVarInt(body.length), body]); };
const mcString = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([writeVarInt(b.length), b]); };

async function resolveTarget(host, port) {
  if (port === 25565 && !net.isIP(host)) {
    try {
      const recs = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (recs && recs.length) { recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight); return { host: recs[0].name, port: recs[0].port }; }
    } catch { /* لا يوجد SRV */ }
  }
  return { host, port };
}

function parseStatus(json) {
  const p = (json && json.players) || {};
  const sample = Array.isArray(p.sample) ? p.sample.map((s) => cleanText(s && s.name)).filter(Boolean) : [];
  let favicon = null;
  if (typeof json.favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(json.favicon) && json.favicon.length < 120000) favicon = json.favicon;
  return {
    version: { name: cleanText(json.version && json.version.name) || null, protocol: Number.isInteger(json.version && json.version.protocol) ? json.version.protocol : null },
    players: { online: Number.isInteger(p.online) ? p.online : null, max: Number.isInteger(p.max) ? p.max : null, sample },
    motd: cleanText(json.description),
    favicon,
  };
}

async function ping(host, port, { timeout = 6000 } = {}) {
  const target = await resolveTarget(host, port);
  await assertPublicHost(target.host, config.ALLOW_PRIVATE);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: target.host, port: target.port });
    let buf = Buffer.alloc(0), stage = 'status', t0 = 0, t1 = 0, info = null, rtt = null, done = false;
    const finish = (err, val) => {
      if (done) return; done = true; clearTimeout(timer); sock.destroy();
      if (val) return resolve(val);
      if (info) return resolve({ ...info, latency: rtt });
      reject(err);
    };
    const timer = setTimeout(() => { const e = new Error('timeout'); e.code = 'ETIMEDOUT'; finish(e); }, timeout);
    sock.setNoDelay(true);
    sock.on('connect', () => {
      const hs = packet(0x00, Buffer.concat([writeVarInt(765), mcString(host), Buffer.from([(port >> 8) & 255, port & 255]), writeVarInt(1)]));
      t0 = Date.now(); sock.write(Buffer.concat([hs, packet(0x00, Buffer.alloc(0))]));
    });
    sock.on('data', (d) => {
      try {
        buf = Buffer.concat([buf, d]);
        if (buf.length > 4 * 1024 * 1024) throw new Error('response too large');
        for (;;) {
          const len = readVarInt(buf, 0); if (!len) return;
          if (buf.length < len.size + len.value) return;
          const body = buf.subarray(len.size, len.size + len.value); buf = buf.subarray(len.size + len.value);
          const id = readVarInt(body, 0); if (!id) throw new Error('bad packet');
          if (stage === 'status' && id.value === 0) {
            const sl = readVarInt(body, id.size); if (!sl) throw new Error('bad status');
            const start = id.size + sl.size;
            const json = JSON.parse(body.subarray(start, start + sl.value).toString('utf8'));
            rtt = Date.now() - t0; info = parseStatus(json); stage = 'pong';
            const payload = Buffer.alloc(8); payload.writeBigInt64BE(BigInt(Date.now()));
            t1 = Date.now(); sock.write(packet(0x01, payload));
          } else if (stage === 'pong' && id.value === 1) {
            return finish(null, { ...info, latency: Date.now() - t1 });
          } else { throw new Error('unexpected packet'); }
        }
      } catch (e) { finish(Object.assign(new Error('ردّ العنوان لكنه لا يبدو سيرفر Minecraft'), { code: 'EPROTO' })); }
    });
    sock.on('error', (e) => finish(e));
    sock.on('close', () => finish(Object.assign(new Error('closed'), { code: 'ECONNRESET' })));
  });
}
module.exports = { ping, readVarInt, writeVarInt };
