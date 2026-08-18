/** [BOOT] public/js/app.js loaded */
console.log('[BOOT] public/js/app.js loaded');

// 可见诊断：页面加载后显示 BOOT OK
(function showBoot() {
  const el = document.createElement('div');
  el.id = 'boot-diagnostic';
  el.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#0f0;color:#000;padding:4px 12px;font-size:14px;font-weight:bold;font-family:monospace;';
  el.textContent = 'BOOT OK';
  document.body.appendChild(el);
})();

import app from '../src/app.js';
import ImportPanel from '../src/ui/import-panel.js';
import Storage from '../src/db/storage.js';

console.log('[BOOT] imports resolved, calling ImportPanel.init()');
ImportPanel.init();

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
app.init().then(() => console.log('[BOOT] app.init() resolved')).catch(err => {
  console.error('[BOOT] app.init() rejected:', err);
  const el = document.getElementById('boot-diagnostic');
  if (el) { el.textContent = 'BOOT FAIL'; el.style.background = '#f00'; el.style.color = '#fff'; }
});
