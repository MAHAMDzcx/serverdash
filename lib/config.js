'use strict';
const path = require('path');
const bool = (v, d) => (v === undefined || v === '' ? d : !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase()));
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),
  ALLOW_PRIVATE: bool(process.env.ALLOW_PRIVATE_HOSTS, false),
  ALLOW_REGISTRATION: bool(process.env.ALLOW_REGISTRATION, true),
  TRUST_PROXY: bool(process.env.TRUST_PROXY, false),
  COOKIE_SECURE: process.env.COOKIE_SECURE === undefined ? true : bool(process.env.COOKIE_SECURE, false),
  MAX_SERVERS: Number(process.env.MAX_SERVERS_PER_USER) || 10,
  SESSION_DAYS: 30,
};
