/** [BOOT] public/js/app.js loaded */
console.log('[BOOT] public/js/app.js loaded');

// 可见诊断状态条
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

// ── debug=scan 模式 ───────────────────────────────────────
const scanMode = new URLSearchParams(window.location.search).get('debug') === 'scan';
if (scanMode) {
  console.log('[BOOT] SCAN MODE activated');
  document.body.dataset.debugScan = 'true';
  const diagPanel = document.getElementById('scan-diagnostic');
  if (diagPanel) diagPanel.style.display = 'block';

  // 每秒刷新诊断数据
  setInterval(() => {
    const cam = CameraModule || {};
    const stream = cam.stream;
    const videoEl = document.getElementById('video');
    const frameEl = document.getElementById('scan-frame');
    const dims = cam.getVideoDimensions?.() || { width: 0, height: 0 };
    const rect = frameEl ? frameEl.getBoundingClientRect() : null;
    const readyState = videoEl ? videoEl.readyState : -1;
    const hasStream = !!stream && stream.active;

    const diaCamera = document.getElementById('scan-dia-camera');
    const diaVideo = document.getElementById('scan-dia-video');
    const diaFrame = document.getElementById('scan-dia-frame');
    if (diaCamera) diaCamera.textContent = `Camera: ${hasStream ? 'READY' : 'NO STREAM'}`;
    if (diaVideo) diaVideo.textContent = `Video: ${readyState}/4  ${dims.width}×${dims.height}`;
    if (diaFrame) diaFrame.textContent = `Frame: ${rect ? `x=${Math.round(rect.x)} y=${Math.round(rect.y)} w=${Math.round(rect.width)} h=${Math.round(rect.height)}` : 'NOT FOUND'}`;
  }, 1000);

  // 加载 Camera 模块并启动
  import('../src/camera/index.js').then(CameraModule_import => {
    window.CameraModule = CameraModule_import.default;
    setBootStatus('SCAN: Starting camera...', '#ff0');
    CameraModule_import.default.startCamera().then(() => {
      const videoEl = document.getElementById('video');
      if (videoEl) {
        videoEl.srcObject = CameraModule_import.default.stream;
        videoEl.play().catch(e => console.warn('[SCAN] autoplay failed:', e));
      }
      setBootStatus('SCAN: Camera OK', '#0f0');
    }).catch(err => {
      console.error('[BOOT] Scan camera error:', err);
      setBootStatus('SCAN FAIL: ' + err.name, '#f00');
    });
  }).catch(err => {
    console.error('[BOOT] Scan mode module import failed:', err);
    setBootStatus('SCAN IMPORT ERR', '#f00');
  });
} else {
  // ── 正常模式 ────────────────────────────────────────────
  import('../src/app.js').then(app => {
    console.log('[BOOT] imports resolved, calling app.init()');
    setBootStatus('STARTING CAMERA...', '#ff0');
    app.default.init().then(() => {
      console.log('[BOOT] app.init() resolved');
      setBootStatus('CAMERA READY', '#0f0');
    }).catch(err => {
      console.error('[BOOT] app.init() rejected:', err);
      setBootStatus('INIT ERROR: ' + err.name, '#f00');
    });
  }).catch(err => {
    console.error('[BOOT] module import failed:', err);
    setBootStatus('IMPORT ERR', '#f00');
  });

  // 导入面板（不影响主流程）
  import('../src/ui/import-panel.js').then(mod => {
    try { mod.default.init(); } catch(e) { console.warn('[BOOT] ImportPanel init failed:', e); }
  }).catch(() => {});
}
