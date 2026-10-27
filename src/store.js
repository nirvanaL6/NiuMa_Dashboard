/**
 * 用户数据层：两种模式共用一套读写接口
 *   免登录（local）：只写 localStorage，永不外发
 *   登录（cloud）  ：本地即时写入 + 防抖推送云端；登录时拉云端快照
 *
 * 数据格式（与预览版保持兼容）：
 *   { v: 2, todos: [...], prefs: {...}, feeds: {...}, coupons: {...}, savedAt }
 */
import { stateApi } from './api.js';

const KEY = 'wd-data';
const MODE_KEY = 'wd-mode'; // 'guest' | 'cloud'
const SCHEMA = 2;

const listeners = new Set();
let syncState = 'idle'; // idle | dirty | syncing | error | offline
let syncError = '';
let cloudVersion = 0;
let lastCloudAt = 0;

export function onData(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readRaw() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function getData() {
  return readRaw() || { v: SCHEMA, todos: null, prefs: {}, savedAt: 0 };
}

export function mode() {
  return localStorage.getItem(MODE_KEY) === 'cloud' ? 'cloud' : 'guest';
}
export function setMode(m) {
  localStorage.setItem(MODE_KEY, m === 'cloud' ? 'cloud' : 'guest');
  emit('mode');
}

/** 由 auth.js 在登录/恢复会话后同步云端版本号，避免首次推送被判冲突 */
export function applyCloudVersion(version, at = 0) {
  cloudVersion = Number(version) || 0;
  lastCloudAt = at || 0;
}

export function syncStatus() {
  return { state: syncState, error: syncError, version: cloudVersion, lastSyncAt: lastCloudAt, mode: mode() };
}

function emit(type = 'data') {
  listeners.forEach((fn) => {
    try { fn(type, getData()); } catch { /* 单个订阅者异常不影响其他 */ }
  });
}

function setSync(state, error = '') {
  syncState = state;
  syncError = error;
  emit('sync');
}

/** 写入本地：立即生效，登录模式下再排队上云 */
export function saveData(patch, { silent = false } = {}) {
  const next = { ...getData(), ...patch, v: SCHEMA, savedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(next));
  if (!silent) emit('data');
  if (mode() === 'cloud') schedulePush();
  return next;
}

/** 整体替换（导入备份 / 云端拉取） */
export function replaceData(data, { touch = true } = {}) {
  const next = { ...(data || {}), v: SCHEMA, savedAt: touch ? Date.now() : data?.savedAt || 0 };
  localStorage.setItem(KEY, JSON.stringify(next));
  emit('data');
  return next;
}

/* ---------------- 同步 ---------------- */
let pushTimer = 0;
function schedulePush() {
  setSync('dirty');
  clearTimeout(pushTimer);
  // 5 秒防抖：连续操作（勾选待办、切偏好）只产生一次写入，保护 D1 配额
  pushTimer = setTimeout(() => { void pushNow(); }, 5000);
}

export async function pushNow({ force = false } = {}) {
  if (mode() !== 'cloud') return { skipped: true };
  clearTimeout(pushTimer);
  setSync('syncing');
  try {
    const res = await stateApi.put(getData(), cloudVersion, force);
    cloudVersion = res.version;
    lastCloudAt = res.updatedAt || Date.now();
    setSync('idle');
    return res;
  } catch (err) {
    if (err.code === 'version_conflict') {
      setSync('conflict', '云端已有更新的数据');
      throw err;
    }
    setSync('error', err.message || '同步失败');
    throw err;
  }
}

/** 登录后/刷新页面时拉取云端快照。返回 { payload, version } */
export async function pullCloud() {
  const res = await stateApi.get();
  cloudVersion = res.version || 0;
  lastCloudAt = res.updatedAt || 0;
  setSync('idle');
  return res;
}

export const stats = () => {
  const raw = localStorage.getItem(KEY) || '';
  return { bytes: new Blob([raw]).size, updatedAt: getData().savedAt || 0 };
};

export { SCHEMA };
