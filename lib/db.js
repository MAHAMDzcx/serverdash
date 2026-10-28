'use strict';
const path = require('path');
const config = require('./config');
const { JsonStore } = require('./store');

const main = new JsonStore(path.join(config.DATA_DIR, 'db.json'), { users: {}, sessions: {}, servers: {} }, 300);
const logs = new JsonStore(path.join(config.DATA_DIR, 'logs.json'), {}, 1500);

function addLog(serverId, level, message) {
  const arr = logs.data[serverId] || (logs.data[serverId] = []);
  arr.push({ t: Date.now(), level, message: String(message).slice(0, 500) });
  if (arr.length > 300) arr.splice(0, arr.length - 300);
  logs.save();
}
function getLogs(serverId, limit = 120) { return (logs.data[serverId] || []).slice(-limit); }
function deleteLogs(serverId) { delete logs.data[serverId]; logs.save(); }
function flushAll() { main.flush(); logs.flush(); }

module.exports = {
  get users() { return main.data.users; },
  get sessions() { return main.data.sessions; },
  get servers() { return main.data.servers; },
  save: () => main.save(),
  addLog, getLogs, deleteLogs, flushAll,
};
