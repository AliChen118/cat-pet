/**
 * preload.js — 安全桥接层
 * 通过 contextBridge 向渲染进程暴露最小可用 API，不暴露 Node 能力。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  /* 配置 */
  getConfig: () => ipcRenderer.invoke('get-config'),
  getMeta: () => ipcRenderer.invoke('get-meta'),
  saveConfig: (patch) => ipcRenderer.invoke('save-config', patch),
  resetConfig: (opts) => ipcRenderer.invoke('reset-config', opts),

  /* 设置窗口与数据管理 */
  openSettings: () => ipcRenderer.invoke('open-settings'),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  chooseDataDir: () => ipcRenderer.invoke('choose-data-dir'),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  migrateData: () => ipcRenderer.invoke('migrate-data'),
  restartApp: () => ipcRenderer.invoke('restart-app'),

  /* 行为 */
  setAutoStart: (enabled) => ipcRenderer.invoke('save-config', { startup: { autoStart: !!enabled } }),
  setClickThrough: (enabled) => ipcRenderer.invoke('save-config', { interact: { clickThrough: !!enabled } }),
  quit: () => ipcRenderer.invoke('quit'),
  notify: (payload) => ipcRenderer.invoke('notify', payload),

  /* 窗口与菜单 */
  moveWindow: (dx, dy) => ipcRenderer.send('win-move', dx, dy),

  /* 状态面板 */
  pushStats: (p) => ipcRenderer.send('stats-live', p),
  doAction: (a) => ipcRenderer.invoke('pet-action', a),

  /* 动态鼠标穿透：鼠标不在猫身上时让事件穿到下层窗口 */
  setMouseIgnore: (ignore) => ipcRenderer.send('mouse-pass', !!ignore),

  /* 设置窗口关闭拦截（有未保存改动时由渲染进程确认） */
  onCloseRequest: (cb) => ipcRenderer.on('settings-close-request', () => cb()),
  confirmCloseWindow: () => ipcRenderer.send('settings-close-confirm'),

  /* AI 自言自语 */
  aiTell: (cat, opts) => ipcRenderer.invoke('ai-tell', cat, opts),
  aiAbort: () => ipcRenderer.invoke('ai-abort'),
  aiTest: () => ipcRenderer.invoke('ai-test'),
  aiSetKey: (k) => ipcRenderer.invoke('ai-set-key', k),
  aiClearKey: () => ipcRenderer.invoke('ai-clear-key'),
  aiHasKey: () => ipcRenderer.invoke('ai-has-key'),
  aiClearRecent: () => ipcRenderer.invoke('ai-clear-recent'),
  onAiSay: (cb) => ipcRenderer.on('ai-say', (_e, p) => cb(p)),
  onAiBusy: (cb) => ipcRenderer.on('ai-busy', (_e, p) => cb(p)),
  onAiDone: (cb) => ipcRenderer.on('ai-done', (_e, p) => cb(p)),

  /* 事件订阅 */
  onAction: (cb) => ipcRenderer.on('action', (_e, a) => cb(a)),
  onConfigChanged: (cb) => ipcRenderer.on('config-changed', (_e, p) => cb(p)),
  onStats: (cb) => ipcRenderer.on('stats-changed', (_e, p) => cb(p)),
  onPanelSide: (cb) => ipcRenderer.on('panel-side', (_e, s) => cb(s)),
  onScreenEdge: (cb) => ipcRenderer.on('screen-edge', (_e, e) => cb(e)),
});
