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

        // 注意：这里不能在 reason 声明前读取 reason，否则每个 tick 都会触发
        // ReferenceError，导致 Detection 永远无法执行。
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
          const parts = [
            `state=${state}`,
            `content=${curContent}`,
            `change=${(curChange * 100).toFixed(1)}%`,
            `stable=${curStableCount}/${config.STABLE_FRAME_COUNT}`,
            `ready=${ready}`,
          ];
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

// ... rest of original app.js unchanged ...