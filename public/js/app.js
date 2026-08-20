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
  const ocrTextRaw = document.getElementById('ocr-text-raw');
  const ocrMetaRaw = document.getElementById('ocr-meta-raw');
  const ocrTextPre = document.getElementById('ocr-text-pre');
  const ocrMetaPre = document.getElementById('ocr-meta-pre');
  const ocrRecommend = document.getElementById('ocr-recommend');
  const ocrTextRec = document.getElementById('ocr-text-rec');
  const ocrMetaRec = document.getElementById('ocr-meta-rec');

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
  // 加载预处理模块
  let PreprocessMod = null;
  Promise.all([
    import('../src/ocr/index.js').then(mod => { OcrMod = mod.default; }),
    import('../src/ocr/preprocess.js').then(mod => { PreprocessMod = mod.default; }),
  ]).then(() => {
    console.log('[OCR] modules loaded, ready for recognition');
  }).catch(err => {
    console.error('[BOOT] OCR/preprocess module import failed:', err);
  });

  // 开始识别按钮 — 双策略 OCR
  ocrBtn.addEventListener('click', async () => {
    if (!OcrMod || !PreprocessMod) {
      console.error('[OCR] modules not loaded');
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

    // 清空显示
    ocrTextRaw.textContent = '';
    ocrMetaRaw.textContent = '';
    ocrTextPre.textContent = '';
    ocrMetaPre.textContent = '';
    ocrRecommend.style.display = 'none';

    try {
      // 截取扫描框区域（原图）
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = rect.width;
      srcCanvas.height = rect.height;
      const sctx = srcCanvas.getContext('2d');
      sctx.drawImage(videoEl, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

      // ── 策略 1：原始图直接 OCR ───────────────────────────
      const origResult = await OcrMod.recognize(srcCanvas);
      if (ocrTextRaw) ocrTextRaw.textContent = origResult.text || '(无识别结果)';
      if (ocrMetaRaw) {
        const parts = [];
        parts.push(`耗时 ${origResult.elapsed}ms`);
        if (origResult.confidence != null) parts.push(`置信 ${origResult.confidence.toFixed(1)}%`);
        if (origResult.error) parts.push('错误: ' + origResult.error);
        ocrMetaRaw.textContent = parts.join('  ');
      }
      console.log('[OCR] original result:', origResult);

      // ── 策略 2：预处理后 OCR ─────────────────────────────
      const preResult = await OcrMod.recognize(PreprocessMod.preprocess(srcCanvas, {
        upscale: true,       // 2x 放大
        contrast: 1.8,       // 对比度增强
        brightness: 10,      // 轻微提亮
        binary: false,       // 暂不二值化（保留灰度细节）
      }));
      if (ocrTextPre) ocrTextPre.textContent = preResult.text || '(无识别结果)';
      if (ocrMetaPre) {
        const parts = [];
        parts.push(`耗时 ${preResult.elapsed}ms`);
        if (preResult.confidence != null) parts.push(`置信 ${preResult.confidence.toFixed(1)}%`);
        if (preResult.error) parts.push('错误: ' + preResult.error);
        ocrMetaPre.textContent = parts.join('  ');
      }
      console.log('[OCR] preprocessed result:', preResult);

      // ── 自动选择推荐结果 ─────────────────────────────────
      // 优先选择置信度更高的，如果接近则选原文更长的
      let bestResult, bestLabel;
      if (origResult.confidence != null && preResult.confidence != null) {
        if (preResult.confidence > origResult.confidence) {
          bestResult = preResult;
          bestLabel = '预处理';
        } else if (origResult.confidence > preResult.confidence) {
          bestResult = origResult;
          bestLabel = '原始';
        } else {
          // 置信度相同，选文本更长的
          bestResult = origResult.text.length >= preResult.text.length ? origResult : preResult;
          bestLabel = origResult.text.length >= preResult.text.length ? '原始' : '预处理';
        }
      } else if (origResult.text && !preResult.text) {
        bestResult = origResult;
        bestLabel = '原始';
      } else if (preResult.text && !origResult.text) {
        bestResult = preResult;
        bestLabel = '预处理';
      } else {
        bestResult = origResult;
        bestLabel = '原始';
      }

      if (bestResult.text) {
        ocrRecommend.style.display = 'block';
        if (ocrTextRec) ocrTextRec.textContent = bestResult.text;
        if (ocrMetaRec) {
          const parts = [];
          parts.push(`来源: ${bestLabel}`);
          parts.push(`耗时 ${bestResult.elapsed}ms`);
          if (bestResult.confidence != null) parts.push(`置信 ${bestResult.confidence.toFixed(1)}%`);
          ocrMetaRec.textContent = parts.join('  ');
        }
        setOcrStatus('状态：识别完成', 'success');
      } else {
        setOcrStatus('状态：未识别到文字', 'error');
      }

      // 总耗时
      const totalElapsed = Math.round(performance.now() - (ocrBtn.__clickTime || performance.now()));
      console.log(`[OCR] total time: ${totalElapsed}ms (original: ${origResult.elapsed}ms, pre: ${preResult.elapsed}ms)`);

    } catch (err) {
      console.error('[OCR] recognition error:', err);
      if (ocrTextRaw) ocrTextRaw.textContent = '(识别失败: ' + err.message + ')';
      setOcrStatus('状态：识别失败', 'error');
    } finally {
      ocrBtn.disabled = false;
    }
  });

  // 保存点击时间用于计时
  ocrBtn.addEventListener('mousedown', () => { ocrBtn.__clickTime = performance.now(); });

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
    console.error('[BOOT] err.stack:', err?.stack);
    console.error('[BOOT] err.cause:', err?.cause);
    setBootStatus('IMPORT ERR: ' + (err?.message || String(err)), '#f00');
  });

  import('../src/ui/import-panel.js').then(mod => {
    try { mod.default.init(); } catch(e) { console.warn('[BOOT] ImportPanel init failed:', e); }
  }).catch(() => {});
}
