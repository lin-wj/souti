/** [BOOT] public/js/app.js loaded */
console.log('[BOOT] public/js/app.js loaded');

// 可见诊断：页面加载后显示状态
let bootEl = null;
function setBootStatus(text, color) {
  if (!bootEl) {
    bootEl = document.createElement('div');
    bootEl.id = 'boot-diagnostic';
    bootEl.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#0f0;color:#000;padding:4px 12px;font-size:14px;font-weight:bold;font-family:monospace;';
    document.body.appendChild(bootEl);
  }
  bootEl.textContent = text;
  bootEl.style.background = color || '#0f0';
  console.log('[BOOT]', text);
}
setBootStatus('BOOT OK');

import app from '../src/app.js';
import ImportPanel from '../src/ui/import-panel.js';
import Storage from '../src/db/storage.js';

console.log('[BOOT] imports resolved, calling ImportPanel.init()');
try {
  ImportPanel.init();
  setBootStatus('IMPORT OK', '#0af');
} catch(e) {
  setBootStatus('IMPORT ERR: ' + e.message, '#f80');
  console.error('[BOOT] ImportPanel.init() failed:', e);
}

const debugBtn = document.getElementById('debug-trigger');
if (debugBtn) {
  debugBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      params.delete('debug');
    } else {
      params.set('debug', '1');
    }
    window.location.search = params.toString();
  });
}

window.addEventListener('load', async () => {
  try {
    const count = await Storage.getQuestionCount();
    if (count > 0) {
      console.log(`[BOOT] 本地题库已加载: ${count} 道题`);
    }
  } catch(e) { console.error('[BOOT] 题库加载失败:', e); }
});

console.log('[BOOT] calling app.init()');
setBootStatus('STARTING CAMERA...', '#ff0');
app.init().then(() => {
  console.log('[BOOT] app.init() resolved');
  setBootStatus('CAMERA READY', '#0f0');
}).catch(err => {
  console.error('[BOOT] app.init() rejected:', err);
  setBootStatus('INIT ERROR: ' + err.name, '#f00');
});

// 每秒输出当前状态，方便手机端诊断
setInterval(() => {
  const stateEl = document.getElementById('state-display');
  if (stateEl) {
    const text = stateEl.textContent;
    if (text && text !== 'INITIALIZING') {
      setBootStatus('STATE: ' + text, '#0af');
    }
  }
}, 2000);
