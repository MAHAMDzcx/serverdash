'use strict';
// mineflayer وهمي يُستخدم في الاختبارات فقط (بدون إنترنت) لاختبار منطق اللوحة.
const { EventEmitter } = require('events');
exports.createBot = (opts) => {
  const bot = new EventEmitter();
  bot.username = opts.username; bot.version = opts.version || '1.20.4';
  bot.chatLog = [];
  bot.setControlState = () => {}; bot.look = () => {};
  bot.chat = (m) => bot.chatLog.push(m);
  bot.quit = () => setImmediate(() => bot.emit('end', 'quit'));
  bot.end = () => bot.emit('end', 'end');
  setTimeout(() => {
    if (opts.username === 'ConnFail') { bot.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })); return bot.emit('end', 'error'); }
    if (opts.username === 'KickMe') { bot.emit('login'); bot.emit('kicked', JSON.stringify({ translate: 'multiplayer.disconnect.not_whitelisted' })); return bot.emit('end', 'kicked'); }
    bot.emit('login');
    bot.entity = { position: { x: 10.5, y: 64, z: -3.2 }, yaw: 0 };
    bot.health = 18; bot.food = 15; bot.game = { gameMode: 'survival', dimension: 'minecraft:overworld', difficulty: 'normal' };
    bot.time = { timeOfDay: 6000 }; bot.player = { ping: 42 };
    bot.players = { [opts.username]: { username: opts.username, ping: 42 }, Steve: { username: 'Steve', ping: 30 } };
    bot.emit('spawn'); bot.emit('messagestr', '<Steve> hello');
  }, 80);
  return bot;
};
