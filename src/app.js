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
import UI from './ui/index.js';
import State from './state/machine.js';
import { setState, getDebugInfo } from './state/store.js';

// ── 运行标志 ──────────────────────────────────────────────
let running = false;
let frameTimer = null;
let resizeObserver = null;
let abortController = null;

// ── 初始化 ────────────────────────────────────────────────
export async function init() {
  UI.init();
  await startCameraLoop();
}

/**
 * 启动摄像头并进入主循环。
 */
async function startCameraLoop() {
  if (running) return;
  running = true;

  setState(State.INITIALIZING);

  try {
    await Camera.startCamera();
    const { stream, videoEl } = Camera;
    UI.setVideoElement(videoEl);
    setState(State.CAMERA_READY);

    // 监听摄像头错误
    Camera.onCameraError((err, message) => {
      setState(State.CAMERA_ERROR, { error: message });
    });

    // 开始主循环
    startDetectionLoop(videoEl);

    // 监听窗口大小变化以重绘识别框
    setupResizeObserver(videoEl);
  } catch (err) {
    console.error('[App] Failed to start camera:', err);
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
      const ready = Detection.isReadyToCapture(videoEl, rect);

      Detection.processFrame(videoEl, rect);

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
 * 触发截取和 AI 识别。
 */
async function triggerCapture(videoEl, rect) {
  setState(State.CAPTURING);

  try {
    const { base64 } = await Processing.extractAndCompress(videoEl, rect);

    setState(State.PROCESSING);

    abortController = new AbortController();
    const result = await solveQuestion(base64, abortController.signal);

    if (!result.success) {
      setState(State.AI_ERROR, { error_code: result.error_code, error: result.error });
      UI.showResult(result);
      return;
    }

    // 记录 hash 用于去重
    const hash = Detection.computePerceptualHash(null, rect.width, rect.height);
    Detection.markRecognized(hash);

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
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  Camera.stopCamera();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

export default { init, destroy };
