/** [BOOT] public/js/app.js loaded */
console.log('[BOOT] public/js/app.js loaded');

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

// ── 工具函数 ───────────────────────────────────────────────
function getVideoDisplayRect() {
  const video = document.getElementById('video');
  if (!video) return null;
  // video 在 #video-container 中居中，object-fit: contain
  // 实际显示区域 = min(containerW/videoW, containerH/videoH) * videoSize
  const container = document.getElementById('video-container');
  if (!container) return null;
  const dims = { width: video.videoWidth, height: video.videoHeight };
  if (!dims.width || !dims.height) return null;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const scale = Math.min(cw / dims.width, ch / dims.height);
  const dw = dims.width * scale;
  const dh = dims.height * scale;
  return { x: (cw - dw) / 2, y: (ch - dh) / 2, width: dw, height: dh, videoW: dims.width, videoH: dims.height };
}

function computeScanFrameVideoRect() {
  const frame = document.getElementById('scan-frame');
  const vidRect = getVideoDisplayRect();
  if (!frame || !vidRect) return null;
  const f = frame.getBoundingClientRect();
  // scan-frame 是 fixed，相对于 viewport
  // video 显示区域相对于 viewport 的左上角 = vidRect.x, vidRect.y
  const scaleX = vidRect.videoW / vidRect.width;
  const scaleY = vidRect.videoH / vidRect.height;
  return {
    x: Math.round((f.left - vidRect.x) * scaleX),
    y: Math.round((f.top - vidRect.y) * scaleY),
    width: Math.round(f.width * scaleX),
    height: Math.round(f.height * scaleY),
  };
}

// ── debug=ocr 模式 ─────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const ocrMode = urlParams.get('debug') === 'ocr';

if (ocrMode) {
  console.log('[BOOT] OCR DEBUG MODE activated');
  document.body.dataset.debugScan = 'true';

  const ocrPanel = document.getElementById('ocr-panel');
  const ocrStatus = document.getElementById('ocr-status');
  const ocrBtn = document.getElementById('ocr-btn');
  const ocrTextEl = document.getElementById('ocr-text');
  const ocrMetaEl = document.getElementById('ocr-meta');

  if (ocrPanel) ocrPanel.style.display = 'block';

  function setOcrStatus(text, cls) {
    if (ocrStatus) {
      ocrStatus.textContent = text;
      ocrStatus.className = 'ocr-status' + (cls ? ' ' + cls : '');
    }
  }

  // 加载 Camera 模块
  import('../src/camera/index.js').then(CameraMod => {
    window.CameraModule = CameraMod.default;
    setBootStatus('OCR: Starting camera...', '#ff0');

    return CameraMod.default.startCamera().then(() => {
      const videoEl = document.getElementById('video');
      if (videoEl && CameraMod.default.stream) {
        videoEl.srcObject = CameraMod.default.stream;
        return videoEl.play().catch(e => console.warn('[OCR] autoplay failed:', e));
      }
    }).then(() => {
      setBootStatus('OCR: Camera OK', '#0f0');
      setOcrStatus('状态：就绪', '');
      console.log('[OCR] camera ready, stream:', !!CameraMod.default.stream);
    }).catch(err => {
      console.error('[BOOT] OCR camera error:', err);
      setBootStatus('OCR FAIL: ' + err.name, '#f00');
      setOcrStatus('状态：摄像头失败 ' + err.name, 'error');
    });
  }).catch(err => {
    console.error('[BOOT] OCR mode module import failed:', err);
    setBootStatus('OCR IMPORT ERR', '#f00');
  });

  // 加载 OCR 模块
  let OcrMod = null;
  import('../src/ocr/index.js').then(mod => {
    OcrMod = mod.default;
    console.log('[OCR] module loaded, ready for init on first use');
  }).catch(err => {
    console.error('[BOOT] OCR module import failed:', err);
  });

  // 开始识别按钮
  ocrBtn.addEventListener('click', async () => {
    if (!OcrMod) {
      console.error('[OCR] module not loaded');
      return;
    }

    const videoEl = document.getElementById('video');
    if (!videoEl || !videoEl.videoWidth) {
      setOcrStatus('状态：视频未就绪', 'error');
      return;
    }

    const rect = computeScanFrameVideoRect();
    if (!rect || rect.width < 10 || rect.height < 10) {
      console.error('[OCR] scan frame rect invalid:', rect);
      setOcrStatus('状态：无法获取扫描框坐标', 'error');
      return;
    }

    console.log('[OCR] capture rect:', rect);
    setOcrStatus('状态：正在识别…', 'recognizing');
    ocrBtn.disabled = true;
    ocrTextEl.textContent = '';
    ocrMetaEl.textContent = '';

    try {
      // 截取扫描框区域
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

      // 执行 OCR
      setOcrStatus('状态：OCR 引擎初始化中…', 'loading');
      const result = await OcrMod.recognize(canvas);

      if (ocrTextEl) ocrTextEl.textContent = result.text || '(无识别结果)';
      if (ocrMetaEl) {
        const parts = [];
        parts.push(`耗时 ${result.elapsed}ms`);
        if (result.confidence != null) parts.push(`置信 ${result.confidence.toFixed(1)}%`);
        if (result.error) parts.push('错误: ' + result.error);
        ocrMetaEl.textContent = parts.join('  ');
      }

      if (result.text) {
        setOcrStatus('状态：识别完成', 'success');
      } else {
        setOcrStatus('状态：未识别到文字', 'error');
      }
      console.log('[OCR] result:', result);
    } catch (err) {
      console.error('[OCR] recognition error:', err);
      if (ocrTextEl) ocrTextEl.textContent = '(识别失败: ' + err.message + ')';
      if (ocrMetaEl) ocrMetaEl.textContent = '错误: ' + err.message;
      setOcrStatus('状态：识别失败', 'error');
    } finally {
      ocrBtn.disabled = false;
    }
  });

  // 每秒刷新诊断数据
  setInterval(() => {
    const cam = window.CameraModule || {};
    const stream = cam.stream;
    const videoEl = document.getElementById('video');
    const frameEl = document.getElementById('scan-frame');
    const dims = cam.getVideoDimensions?.() || { width: 0, height: 0 };
    const rect = frameEl ? frameEl.getBoundingClientRect() : null;
    const readyState = videoEl ? videoEl.readyState : -1;
    const hasStream = !!stream && stream.active;
    const diagCamera = document.getElementById('scan-dia-camera');
    const diagVideo = document.getElementById('scan-dia-video');
    const diagFrame = document.getElementById('scan-dia-frame');
    if (diagCamera) diagCamera.textContent = `Camera: ${hasStream ? 'READY' : 'NO STREAM'}`;
    if (diagVideo) diagVideo.textContent = `Video: ${readyState}/4  ${dims.width}×${dims.height}`;
    if (diagFrame) diagFrame.textContent = rect ? `Frame: x=${Math.round(rect.x)} y=${Math.round(rect.y)} w=${Math.round(rect.width)} h=${Math.round(rect.height)}` : 'Frame: NOT FOUND';
  }, 1000);

} else if (urlParams.get('debug') === 'scan') {
  // ── debug=scan 模式（原有逻辑）──────────────────────────
  console.log('[BOOT] SCAN MODE activated');
  document.body.dataset.debugScan = 'true';
  const diagPanel = document.getElementById('scan-diagnostic');
  if (diagPanel) diagPanel.style.display = 'block';

  setInterval(() => {
    const cam = window.CameraModule || {};
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
    if (diaFrame) diaFrame.textContent = rect ? `Frame: x=${Math.round(rect.x)} y=${Math.round(rect.y)} w=${Math.round(rect.width)} h=${Math.round(rect.height)}` : 'Frame: NOT FOUND';
  }, 1000);

  import('../src/camera/index.js').then(CameraMod => {
    window.CameraModule = CameraMod.default;
    setBootStatus('SCAN: Starting camera...', '#ff0');
    CameraMod.default.startCamera().then(() => {
      const videoEl = document.getElementById('video');
      if (videoEl && CameraMod.default.stream) {
        videoEl.srcObject = CameraMod.default.stream;
        videoEl.play().catch(e => console.warn('[SCAN] autoplay failed:', e));
      }
      setBootStatus('SCAN: Camera OK', '#0f0');
    }).catch(err => {
      console.error('[BOOT] Scan camera error:', err);
      setBootStatus('SCAN FAIL: ' + err.name, '#f00');
    });
  }).catch(err => {
    console.error('[BOOT] Scan mode import failed:', err);
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

  import('../src/ui/import-panel.js').then(mod => {
    try { mod.default.init(); } catch(e) { console.warn('[BOOT] ImportPanel init failed:', e); }
  }).catch(() => {});
}
