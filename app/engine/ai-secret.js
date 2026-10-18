/**
 * ai-secret.js — API Key 的本地加密存储
 *
 * 为什么不放 config.json：配置可导出/分享/备份，Key 一旦写进去就跟着泄露。
 * 这里独立成文件，Windows 下走 DPAPI（Electron safeStorage）。
 *
 * 文件格式（二进制，前 2 字节是魔数）：
 *   'S1' + safeStorage.encryptString(key)   系统级加密
 *   'P1' + utf8(key)                        加密不可用时的明文降级（UI 需提示）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'ai-secret.bin';
const MAGIC_ENC = Buffer.from('S1', 'ascii');
const MAGIC_PLAIN = Buffer.from('P1', 'ascii');

function secretPath(dir) {
  return path.join(dir, FILE_NAME);
}

function safeStorageRef() {
  try {
    // 延迟 require：仅主进程使用本模块
    const { safeStorage } = require('electron');
    return safeStorage || null;
  } catch (_) {
    return null;
  }
}

function encryptionAvailable() {
  const ss = safeStorageRef();
  if (!ss) return false;
  try {
    return !!ss.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

/** 写入密钥；返回 { ok, encrypted } */
function setKey(dir, key) {
  const s = String(key == null ? '' : key).trim();
  if (!s) return { ok: false, reason: 'empty' };
  try {
    const ss = safeStorageRef();
    let buf;
    let encrypted = false;
    if (ss && encryptionAvailable()) {
      buf = Buffer.concat([MAGIC_ENC, ss.encryptString(s)]);
      encrypted = true;
    } else {
      buf = Buffer.concat([MAGIC_PLAIN, Buffer.from(s, 'utf8')]);
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = secretPath(dir) + '.tmp';
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, secretPath(dir));
    return { ok: true, encrypted };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** 读取密钥；不存在或解密失败返回 '' */
function getKey(dir) {
  let buf;
  try {
    buf = fs.readFileSync(secretPath(dir));
  } catch (_) {
    return '';
  }
  if (!buf || buf.length < 3) return '';
  try {
    if (buf.slice(0, 2).equals(MAGIC_ENC)) {
      const ss = safeStorageRef();
      if (!ss) return '';
      return ss.decryptString(buf.slice(2));
    }
    if (buf.slice(0, 2).equals(MAGIC_PLAIN)) {
      return buf.slice(2).toString('utf8');
    }
  } catch (_) {
    return '';
  }
  return '';
}

function hasKey(dir) {
  return !!getKey(dir);
}

function clearKey(dir) {
  try {
    fs.unlinkSync(secretPath(dir));
    return true;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

module.exports = { secretPath, encryptionAvailable, setKey, getKey, hasKey, clearKey };
