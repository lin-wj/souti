/**
 * 主控制器 — 串联 Camera、Detection、Processing、Provider、UI
 *
 * 核心循环：
 *   1. 每 FRAME_INTERVAL ms 从视频流抽取一帧
 *   2. 在识别框区域内检测变化和稳定
 *   3. 满足条件时截取最佳帧并调用 AI
 *   4. 显示结果，进入等待变化状态
 *   5. 检测到变化后重复上述过程
 */

import config from './config.js';
import Camera from './camera/index.js';
import Detection, { _lastChange, _lastHasContent, _lastIsStable } from './detection/index.js';
import Processing from './processing/index.js';
import { solveQuestion, ErrorCode } from './provider/index.js';
import OCR from './ocr/index.js';
import UI from './ui/index.js';
import State from './state/machine.js';
import { setState, getDebugInfo } from './state/store.js';

console.log('[APP] src/app.js loaded');

// ── 运行标志 ──────────────────────────────────────────────
let running = false;
let frameTimer = null;
let resizeObserver = null;
let abortController = null;
let ocrTimer = null;       // OCR 调试独立定时器
let lastOCRTimer = 0;      // 上次 OCR 触发时间（去抖）

console.log('[APP] navigator.mediaDevices:', typeof navigator.mediaDevices);
console.log('[APP] getUserMedia:', typeof navigator.mediaDevices?.getUserMedia);
console.log('[APP] location.protocol:', location.protocol);
console.log('[APP] location.hostname:', location.hostname);

// ── 初始化 ────────────────────────────────────────────────
export async function init() {
  console.log('[APP] init start');
  UI.init();
  console.log('[APP] UI.init() done, calling startCameraLoop()');
  await startCameraLoop();
  console.log('[APP] init complete');
}

/**
 * 启动摄像头并进入主循环。
 */
async function startCameraLoop() {
  console.log('[CAMERA] startCameraLoop start, running=', running);
  if (running) { console.log('[CAMERA] already running, skip'); return; }
  running = true;

  setState(State.INITIALIZING);

  try {
    console.log('[CAMERA] calling Camera.startCamera()');
    await Camera.startCamera();
    const { stream, videoEl } = Camera;
    console.log('[CAMERA] startCamera() resolved, stream=', !!stream, 'videoEl=', !!videoEl);
    UI.setVideoElement(videoEl);
    setState(State.CAMERA_READY);
    console.log('[CAMERA] setState(CAMERA_READY) done');

    // 监听摄像头错误
    Camera.onCameraError((err, message) => {
      setState(State.CAMERA_ERROR, { error: message });
    });

    // 开始主循环
    startDetectionLoop(videoEl);

    // 启动 OCR 调试循环（独立于主状态机，仅 debug 模式）
    startOCRDetectionLoop(videoEl);

    // 监听窗口大小变化以重绘识别框
    setupResizeObserver(videoEl);
  } catch (err) {
    console.error('[CAMERA] startCameraLoop error:', err.name, err.message);
    console.error('[CAMERA] full error:', err);
    setState(State.CAMERA_ERROR, { error: err.message });
    running = false;
  }
}

/**
 * 主检测循环 — 按 FRAME_INTERVAL 定时抽帧。
 */
function startDetectionLoop(videoEl) {
  stopDetectionLoop(); // 确保只有一条循环

  const loop = () => {
    if (!running) return;

    const videoSize = Camera.getVideoDimensions();
    if (!videoSize) {
      frameTimer = setTimeout(loop, config.FRAME_INTERVAL);
      return;
    }

    // 获取 display 尺寸
    const displayEl = document.getElementById('video-container');
    const displaySize = displayEl
      ? { width: displayEl.clientWidth, height: displayEl.clientHeight }
      : null;

    if (displaySize) {
      const rect = Detection.computeRect(videoSize, displaySize);

      // 先处理当前帧，更新 lastFrameData 和稳定状态
      Detection.processFrame(videoEl, rect);

      // 再基于已处理的帧判断是否可触发识别
      const ready = Detection.isReadyToCapture(videoEl, rect);

      if (ready) {
        triggerCapture(videoEl, rect);
      }

      // 调试信息
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

    frameTimer = setTimeout(loop, config.FRAME_INTERVAL);
  };

  frameTimer = setTimeout(loop, config.FRAME_INTERVAL);
}

function stopDetectionLoop() {
  if (frameTimer) {
    clearTimeout(frameTimer);
    frameTimer = null;
  }
}

/**
 * OCR 调试循环 — 独立于主状态机，仅在画面稳定时触发 OCR。
 * 不改变状态，不触发识别流程，仅展示原始 OCR 结果供调试。
 */
function startOCRDetectionLoop(videoEl) {
  stopOCRDetectionLoop();

  const interval = 2000; // 每 2 秒尝试一次 OCR（避免高频调用）

  const loop = () => {
    if (!running) return;

    const state = State.getState();
    // 只在 CAMERA_READY 或 WAITING_FOR_CHANGE 时做 OCR 预览
    // PROCESSING/MATCHING 期间跳过，避免干扰
    if (state === State.CAMERA_READY || state === State.WAITING_FOR_CHANGE) {
      const now = Date.now();
      if (now - lastOCRTimer < interval) {
        ocrTimer = setTimeout(loop, interval);
        return;
      }

      const videoSize = Camera.getVideoDimensions();
      if (!videoSize) {
        ocrTimer = setTimeout(loop, interval);
        return;
      }

      const displayEl = document.getElementById('video-container');
      if (!displayEl) {
        ocrTimer = setTimeout(loop, interval);
        return;
      }

      const displaySize = { width: displayEl.clientWidth, height: displayEl.clientHeight };
      const rect = Detection.computeRect(videoSize, displaySize);
      const frameData = Detection.captureFrameForHash(videoEl, rect);

      if (frameData) {
        lastOCRTimer = now;
        // 使用临时 canvas 传给 OCR
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = rect.width;
        tempCanvas.height = rect.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.putImageData(new ImageData(frameData, rect.width, rect.height), 0, 0);

        OCR.recognize(tempCanvas).then(result => {
          UI.showOCRDebug(result);
        }).catch(err => {
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
  if (ocrTimer) {
    clearTimeout(ocrTimer);
    ocrTimer = null;
  }
}

/**
 * 触发截取和 AI 识别。
 */
async function triggerCapture(videoEl, rect) {
  setState(State.CAPTURING);

  try {
    const { base64 } = await Processing.extractAndCompress(videoEl, rect);

    // TODO Phase 2D: 替换为 OCR + 本地题库匹配
    setState(State.PROCESSING);

    abortController = new AbortController();
    const result = await solveQuestion(base64, abortController.signal);

    if (!result.success) {
      setState(State.AI_ERROR, { error_code: result.error_code, error: result.error });
      UI.showResult(result);
      return;
    }

    // 记录 hash 用于去重（从当前视频帧提取）
    const frameData = Detection.captureFrameForHash(videoEl, rect);
    const hash = frameData ? Detection.computePerceptualHash(frameData, rect.width, rect.height) : null;
    Detection.markRecognized(hash);
    Detection.resetDetection(); // 重置稳定计时器，防止下一题过快触发

    setState(State.SHOWING_RESULT, { result });
    UI.showResult(result);

    // 进入等待变化状态
    setTimeout(() => {
      setState(State.WAITING_FOR_CHANGE);
    }, 500);
  } catch (err) {
    console.error('[App] Capture error:', err);
    if (err.name !== 'AbortError') {
      setState(State.AI_ERROR, { error: err.message });
      UI.showResult({ success: false, error: err.message, error_code: ErrorCode.UNKNOWN });
    }
  } finally {
    abortController = null;
  }
}

/**
 * 监听窗口大小变化，重绘识别框。
 */
function setupResizeObserver(videoEl) {
  if (resizeObserver) resizeObserver.disconnect();

  resizeObserver = new ResizeObserver(() => {
    const videoSize = Camera.getVideoDimensions();
    if (!videoSize) return;

    const displayEl = document.getElementById('video-container');
    if (!displayEl) return;

    const displaySize = { width: displayEl.clientWidth, height: displayEl.clientHeight };
    const rect = Detection.computeRect(videoSize, displaySize);
    UI.drawFrameOverlay(rect, videoSize, displaySize);
  });

  const videoContainer = document.getElementById('video-container');
  if (videoContainer) {
    resizeObserver.observe(videoContainer);
  }
}

/**
 * 停止所有运行中的任务。
 */
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
