// debug=ocr deployed v2
/**
 * 主控制器 — 串联 Camera、Detection、Processing、Provider、UI
 *
 * 核心原则：
 *   - CAMERA_ERROR 只能由 getUserMedia 本身失败触发
 *   - Detection/OCR/UI 的任何异常都不能修改摄像头状态
 *   - debug=scan 模式仅验证摄像头+扫描框，不启动 Detection/OCR
 */

import config from './config.js';
import Camera from './camera/index.js';
import Detection, { _lastChange, _lastHasContent, _lastIsStable } from './detection/index.js';
import Processing from './processing/index.js';
import OCR from './ocr/index.js';
import Search from './search/index.js';
import UI from './ui/index.js';
import State from './state/machine.js';
import { setState, getDebugInfo, getState } from './state/store.js';

let Trace = null;

console.log('[APP] src/app.js loaded');
console.log('[APP] navigator.mediaDevices:', typeof navigator.mediaDevices);
console.log('[APP] getUserMedia:', typeof navigator.mediaDevices?.getUserMedia);
console.log('[APP] location.protocol:', location.protocol);
console.log('[APP] location.hostname:', location.hostname);

let running = false;
let frameTimer = null;
let resizeObserver = null;
let abortController = null;
let ocrTimer = null;
let lastOCRTimer = 0;
let lastBlockedReason = null;

export async function init() {
  console.log('[APP] init start');
  
  if (new URLSearchParams(window.location.search).get('debug') === 'trace') {
    try {
      const traceMod = await import('./trace/index.js');
      Trace = traceMod.default;
      window.Trace = traceMod.default;
      Trace.init(config);
      console.log('[APP] trace mode enabled');
    } catch(e) {
      console.error('[APP] trace init failed:', e);
    }
  }
  
  UI.init();
  console.log('[APP] UI.init() done, calling startCameraLoop()');
  await startCameraLoop();
  console.log('[APP] init complete');
}

async function startCameraLoop() {
  console.log('[CAMERA] startCameraLoop start, running=', running);
  if (running) { console.log('[CAMERA] already running, skip'); return; }
  running = true;
  setState(State.INITIALIZING, { source: 'init' });

  try {
    console.log('[CAMERA] calling Camera.startCamera()');
    await Camera.startCamera();
    console.log('[TRACE] CAMERA_GET_USER_MEDIA_SUCCESS');
    const stream = Camera.stream;
    const videoEl = document.getElementById('video');
    console.log('[CAMERA] startCamera() resolved, stream=', !!stream, 'videoEl=', !!videoEl);

    if (videoEl && stream) {
      videoEl.srcObject = stream;
      console.log('[TRACE] CAMERA_STREAM_ATTACHED');
      await videoEl.play();
      console.log('[TRACE] CAMERA_PLAY_SUCCESS');
    }
    UI.setVideoElement(videoEl);

    Camera.onCameraError((err, message) => {
      console.error('[CAMERA] onCameraError fired (stream still exists:', !!Camera.stream, ')', err.name, message);
      if (!Camera.stream) {
        setState(State.CAMERA_ERROR, { error: err, source: 'onCameraError', message });
      } else {
        console.warn('[CAMERA] onCameraError ignored — stream is active');
      }
    });

    console.log('[TRACE] BEFORE_CAMERA_READY');
    setState(State.CAMERA_READY, { source: 'startCameraLoop' });
    console.log('[TRACE] AFTER_CAMERA_READY');

    const isScanMode = new URLSearchParams(window.location.search).get('debug') === 'scan';
    if (!isScanMode) {
      console.log('[CAMERA] starting detection loop');
      startDetectionLoop(videoEl);
      startOCRDetectionLoop(videoEl);
      setupResizeObserver(videoEl);
    } else {
      console.log('[CAMERA] scan mode — skipping Detection/OCR');
    }
  } catch (err) {
    console.error('[CAMERA] startCameraLoop error:', err.name, err.message);
    console.error('[CAMERA] full error:', err);
    console.trace('[CAMERA] error stack');
    const canBeCameraError = !Camera.stream || err.name === 'NotAllowedError' || err.name === 'NotFoundError';
    if (canBeCameraError) {
      setState(State.CAMERA_ERROR, { error: err, source: 'startCameraLoop.catch', message: err.message });
    } else {
      console.warn('[CAMERA] non-camera error, keeping current state:', err.name);
    }
    running = false;
  }
}

function startDetectionLoop(videoEl) {
  stopDetectionLoop();
  console.log('[SCAN] detection loop ENTERED, videoEl=', !!videoEl, 'running=', running, 'Trace=', !!Trace);
  if (Trace) Trace.trace('SCAN', 'detection loop ENTERED, videoEl=', !!videoEl, 'running=', running, 'Trace=', !!Trace);

  const loop = () => {
    if (!running) {
      if (Trace) Trace.trace('SCAN', 'loop tick SKIPPED: running=false');
      return;
    }
    if (Trace) {
      Trace.inc('detection');
      Trace.trace('SCAN', 'tick running=', running, 'state=', getState(),
                  'videoW=', Camera.getVideoDimensions()?.width ?? 0,
                  'rect=', Detection.computeRect(Camera.getVideoDimensions(), {width: 390, height: 844})?.width ?? '?');
    }

    try {
      const videoSize = Camera.getVideoDimensions();
      if (!videoSize) {
        frameTimer = setTimeout(loop, config.FRAME_INTERVAL);
        return;
      }

      const displayEl = document.getElementById('video-container');
      const displaySize = displayEl
        ? { width: displayEl.clientWidth, height: displayEl.clientHeight }
        : null;

      if (displaySize) {
        const rect = Detection.computeRect(videoSize, displaySize);
        const state = getState();
        const prevContent = Detection['_lastHasContent'].value;
        const prevStableCount = Detection['_stableCount'].value;

        Detection.processFrame(videoEl, rect);
        const readyResult = Detection.isReadyToCapture(videoEl, rect);
        const ready = readyResult.ready;
        const reason = readyResult.reason;
        const similarity = readyResult.similarity;
        const cooldownRemaining = readyResult.remaining;

        const curContent = Detection['_lastHasContent'].value;
        const curChange = Detection['_lastChange'].value;
        const curStableCount = Detection['_stableCount'].value;
        const now = Date.now();
        const cdRemaining = Math.max(0, config.COOLDOWN_TIME - (now - Detection['_lastRecognitionTime'].value));
        const lastHash = Detection['_lastRecognizedHash'].value;

        if (Trace) {
          Trace.showState({
            content: curContent,
            change: curChange,
            stable: `${curStableCount}/${config.STABLE_FRAME_COUNT}`,
            changeFromRecognized: Detection['_changeFromRecognized']?.value ?? 0,
            questionChanged: Detection['_questionChanged']?.value ?? false,
            questionChangedCount: Detection['_questionChangedCount']?.value ?? 0,
            ready,
            reason,
            similarity: similarity ?? '-',
            cooldown: cdRemaining,
          });
        }

        const contentChanged = curContent !== prevContent;
        const stableChanged = curStableCount !== prevStableCount;
        const reasonChanged = lastBlockedReason !== reason;
        const becameReady = ready && !reason;

        if (contentChanged || stableChanged || reasonChanged || becameReady) {
          const parts = [`state=${state}`, `content=${curContent}`, `change=${(curChange*100).toFixed(1)}%`,
                         `stable=${curStableCount}/${config.STABLE_FRAME_COUNT}`, `ready=${ready}`];
          if (reason) parts.push(`reason=${reason}`);
          if (similarity !== undefined && similarity !== null) parts.push(`sim=${similarity}`);
          if (cdRemaining > 0) parts.push(`cd=${Math.ceil(cdRemaining)}ms`);
          if (lastHash) parts.push(`hash=${lastHash.substring(0, 8)}`);
          const logMsg = parts.join(' ');
          console.log(`[SCAN] ${logMsg}`);
          if (Trace) Trace.trace('SCAN', logMsg);
        }

        lastBlockedReason = reason || null;

        if (ready) {
          console.log('[SCAN] ready=true → triggerCapture');
          if (Trace) Trace.trace('SCAN', 'READY → CAPTURE');
          triggerCapture(videoEl, rect);
        }

        UI.drawFrameOverlay(rect, videoSize, displaySize);

        const info = getDebugInfo();
        const debug = info.current === State.PROCESSING || info.current === State.SHOWING_RESULT
          ? null
          : {
              fps: Math.round(1000 / config.FRAME_INTERVAL),
              change: Detection['_lastChange'] ?? 0,
              hasContent: Detection['_lastHasContent'] ?? false,
              isStable: Detection['_lastIsStable'] ?? false,
            };
        if (debug) {
          UI.updateDebugFPS(debug.fps, _lastChange.value, _lastHasContent.value, _lastIsStable.value);
        }
      }
    } catch (err) {
      console.error('[App] Detection loop error (state unchanged):', err.name, err.message);
      console.error('[App] Stack:', err.stack);
      if (Trace) Trace.trace('ERROR', 'Detection loop error', { name: err.name, message: err.message });
      Trace?.inc('error');
    }

    frameTimer = setTimeout(loop, config.FRAME_INTERVAL);
  };

  frameTimer = setTimeout(loop, config.FRAME_INTERVAL);
}

function stopDetectionLoop() {
  if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
}

function startOCRDetectionLoop(videoEl) {
  stopOCRDetectionLoop();
  const interval = 2000;
  const loop = () => {
    if (!running) {
      if (Trace) Trace.trace('SCAN', 'loop tick SKIPPED: running=false');
      return;
    }
    if (Trace) Trace.trace('SCAN', 'tick running=', running, 'state=', getState(), 'videoW=', Camera.getVideoDimensions()?.width ?? 0);
    const state = getState();
    if (state === State.CAMERA_READY || state === State.WAITING_FOR_CHANGE) {
      const now = Date.now();
      if (now - lastOCRTimer < interval) { ocrTimer = setTimeout(loop, interval); return; }
      const videoSize = Camera.getVideoDimensions();
      if (!videoSize) { ocrTimer = setTimeout(loop, interval); return; }
      const displayEl = document.getElementById('video-container');
      if (!displayEl) { ocrTimer = setTimeout(loop, interval); return; }
      const displaySize = { width: displayEl.clientWidth, height: displayEl.clientHeight };
      const rect = Detection.computeRect(videoSize, displaySize);
      const frameData = Detection.captureFrameForHash(videoEl, rect);
      if (frameData) {
        lastOCRTimer = now;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = rect.width;
        tempCanvas.height = rect.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.putImageData(new ImageData(frameData, rect.width, rect.height), 0, 0);
        OCR.recognize(tempCanvas).then(result => UI.showOCRDebug(result)).catch(err => {
          console.error('[App] OCR error:', err);
          UI.showOCRDebug({ text: '', error: err.message });
        });
      }
    }
    ocrTimer = setTimeout(loop, interval);
  };
  ocrTimer = setTimeout(loop, interval);
}

function stopOCRDetectionLoop() {
  if (ocrTimer) { clearTimeout(ocrTimer); ocrTimer = null; }
}

async function triggerCapture(videoEl, rect) {
  console.log('[CAPTURE] started, state:', getState(), 'rect:', JSON.stringify(rect));
  if (Trace) Trace.trace('CAPTURE', 'started', 'state=', getState(), 'rect=', JSON.stringify(rect));
  Trace?.inc('capture');
  setState(State.CAPTURING, { source: 'triggerCapture' });
  try {
    const frameData = Detection.captureFrameForHash(videoEl, rect);
    if (!frameData) {
      console.warn('[CAPTURE] No frame data captured');
      setState(State.NO_CONTENT, { source: 'triggerCapture' });
      return;
    }
    console.log('[CAPTURE] frame captured:', frameData.length, 'bytes, rect:', rect.width, 'x', rect.height);

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = rect.width;
    captureCanvas.height = rect.height;
    const ctx = captureCanvas.getContext('2d');
    ctx.putImageData(new ImageData(frameData, rect.width, rect.height), 0, 0);
    console.log('[CAPTURE] canvas created:', captureCanvas.width, 'x', captureCanvas.height);

    const preprocessed = preprocessCanvas(captureCanvas);
    console.log('[OCR] starting recognition...');
    const [origResult, preResult] = await Promise.all([
      OCR.recognize(captureCanvas),
      OCR.recognize(preprocessed),
    ]);
    console.log('[OCR] done. orig:', origResult.elapsed, 'ms conf=' + (origResult.confidence ?? 'null'), 'text:', JSON.stringify(origResult.text)?.substring(0, 60));
    console.log('[OCR] pre:', preResult.elapsed, 'ms conf=' + (preResult.confidence ?? 'null'), 'text:', JSON.stringify(preResult.text)?.substring(0, 60));

    const ocrText = (preResult.confidence ?? 0) > (origResult.confidence ?? 0) ? preResult.text : origResult.text;
    const ocrConfidence = (preResult.confidence ?? 0) > (origResult.confidence ?? 0) ? preResult.confidence : origResult.confidence;
    console.log(`[OCR] selected: "${ocrText?.substring(0, 40)}..." conf=${ocrConfidence?.toFixed(1)}%`);

    if (!ocrText) {
      console.warn('[CAPTURE] OCR returned empty text');
      Detection.startCooldown();
      Detection.resetStableState();
      setState(State.NO_CONTENT, { source: 'triggerCapture' });
      return;
    }

    console.log('[SEARCH] querying:', JSON.stringify(ocrText)?.substring(0, 80));
    const searchResult = await Search.search(ocrText);
    console.log('[SEARCH] result:', searchResult.matchType, 'confidence:', searchResult.confidence?.toFixed(3), searchResult.question ? 'FOUND: ' + searchResult.question.text.substring(0, 40) : 'NOT FOUND');

    const hash = Detection.computePerceptualHash(frameData, rect.width, rect.height);
    if (searchResult.question) {
      Detection.markRecognized(hash, frameData);
      Detection.resetStableState();
      console.log('[UI] showing database result, type:', searchResult.matchType);
      setState(State.SHOWING_RESULT, { source: 'triggerCapture' });
      UI.showDatabaseResult({ question: searchResult.question, matchType: searchResult.matchType, confidence: searchResult.confidence });
      setTimeout(() => {
        console.log('[STATE] transitioning to WAITING_FOR_CHANGE');
        setState(State.WAITING_FOR_CHANGE, { source: 'triggerCapture' });
      }, 500);
    } else {
      Detection.startCooldown();
      Detection.resetStableState();
      console.log('[CAPTURE] 题库未匹配，暂不调用 AI 兜底');
      setState(State.NO_CONTENT, { source: 'triggerCapture' });
    }
  } catch (err) {
    console.error('[CAPTURE] error:', err.name, err.message);
    console.error('[CAPTURE] stack:', err.stack);
    if (err.name !== 'AbortError') {
      setState(State.AI_ERROR, { error: err.message, source: 'triggerCapture.catch' });
      UI.showResult({ success: false, error: err.message, error_code: 'ai_failed' });
    }
  }
}

function preprocessCanvas(src) {
  try {
    const upscaled = document.createElement('canvas');
    upscaled.width = src.width * 2;
    upscaled.height = src.height * 2;
    const uctx = upscaled.getContext('2d');
    uctx.imageSmoothingEnabled = true;
    uctx.imageSmoothingQuality = 'high';
    uctx.drawImage(src, 0, 0, upscaled.width, upscaled.height);
    const enhanced = document.createElement('canvas');
    enhanced.width = upscaled.width;
    enhanced.height = upscaled.height;
    const ectx = enhanced.getContext('2d', { willReadFrequently: true });
    ectx.drawImage(upscaled, 0, 0);
    const imageData = ectx.getImageData(0, 0, enhanced.width, enhanced.height);
    const data = imageData.data;
    const factor = (259 * (1.8 + 1)) / (259 - 1.8);
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      const val = Math.min(255, Math.max(0, factor * (gray - 128) + 128 + 10));
      data[i] = data[i+1] = data[i+2] = val;
    }
    ectx.putImageData(imageData, 0, 0);
    return enhanced;
  } catch (e) {
    console.warn('[App] preprocessCanvas failed:', e);
    return src;
  }
}

export function destroy() {
  running = false;
  stopDetectionLoop();
  stopOCRDetectionLoop();
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  Camera.stopCamera();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  OCR.destroy();
}

export default { init, destroy };
// debug=ocr deployed v4 - 1787128011
