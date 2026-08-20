/**
 * UI 模块 — 负责所有 DOM 操作和界面渲染
 *
 * 职责：
 *   - 渲染摄像头预览
 *   - 绘制识别框覆盖层
 *   - 显示状态提示
 *   - 显示识别结果
 *   - 显示调试面板
 */

import State, { stateLabel } from '../state/machine.js';
import { getState, subscribe } from '../state/store.js';
import { getErrorHint } from '../provider/index.js';

// ── DOM 引用 ──────────────────────────────────────────────
let els = {};

function cacheElements() {
  els = {
    video: document.getElementById('video'),
    canvas: document.getElementById('overlay-canvas'),
    statusText: document.getElementById('status-text'),
    statusSubtext: document.getElementById('status-subtext'),
    resultContainer: document.getElementById('result-container'),
    resultQuestion: document.getElementById('result-question'),
    resultAnswer: document.getElementById('result-answer'),
    resultExplanation: document.getElementById('result-explanation'),
    resultSubject: document.getElementById('result-subject'),
    resultConfidence: document.getElementById('result-confidence'),
    errorHint: document.getElementById('error-hint'),
    debugPanel: document.getElementById('debug-panel'),
    debugContent: document.getElementById('debug-content'),
    fpsCounter: document.getElementById('fps-counter'),
    stateDisplay: document.getElementById('state-display'),
    // OCR 调试
    ocrDebug: document.getElementById('ocr-debug'),
    ocrText: document.getElementById('ocr-text'),
    ocrMeta: document.getElementById('ocr-meta'),
  };
}

// ── 初始化 ────────────────────────────────────────────────
export function init() {
  cacheElements();
  subscribe(onStateChange);
  applyDebugMode();
}

function applyDebugMode() {
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';
  if (debug) {
    document.body.classList.add('debug-mode');
  } else {
    document.body.classList.remove('debug-mode');
  }
}

// ── 状态变更渲染 ──────────────────────────────────────────
function onStateChange({ state, debug }) {
  renderState(state, debug);
}

function renderState(state, debug) {
  // 更新状态文字
  els.statusText.textContent = stateLabel(state);

  // 更新子状态文字
  const subtexts = {
    [State.INITIALIZING]: '正在启动摄像头，请允许权限…',
    [State.CAMERA_READY]: '将题目放入识别框内，系统会自动识别',
    [State.SEARCHING]: '正在搜索题目…',
    [State.DETECTING]: '检测到画面变化',
    [State.STABILIZING]: '请保持手机稳定，正在确认…',
    [State.CAPTURING]: '正在截取画面',
    [State.PROCESSING]: 'AI 正在识别和解题，请稍候…',
    [State.SHOWING_RESULT]: '',
    [State.WAITING_FOR_CHANGE]: '识别成功！移动手机到下一道题…',
    [State.CAMERA_ERROR]: '无法访问摄像头，请检查权限设置',
    [State.NETWORK_ERROR]: '网络连接异常',
    [State.AI_ERROR]: 'AI 识别失败',
    [State.INVALID_IMAGE]: '图片质量不足',
    [State.NO_QUESTION]: '未检测到题目',
  };
  els.statusSubtext.textContent = subtexts[state] ?? '';

  // 隐藏结果区域（除非是 SHOWING_RESULT 或 waiting）
  const showResult =
    state === State.SHOWING_RESULT ||
    state === State.WAITING_FOR_CHANGE ||
    state === State.AI_ERROR ||
    state === State.INVALID_IMAGE ||
    state === State.NO_QUESTION ||
    state === State.NETWORK_ERROR;

  els.resultContainer.classList.toggle('visible', showResult);

  // 调试面板
  if (els.debugPanel) {
    const isDebug = document.body.classList.contains('debug-mode');
    els.debugPanel.style.display = isDebug ? 'block' : 'none';
    if (els.ocrDebug) els.ocrDebug.style.display = isDebug ? 'block' : 'none';
    if (debug) {
      els.stateDisplay.textContent = state;
      els.debugContent.innerHTML = formatDebugInfo(debug);
    }
  }
}

function formatDebugInfo(debug) {
  const lines = [];
  if (debug.prev) lines.push(`<span class="debug-prev">上一个: ${debug.prev}</span>`);
  if (debug.timestamp) {
    const d = new Date(debug.timestamp);
    lines.push(`时间: ${d.toLocaleTimeString()}`);
  }
  return lines.join('<br>');
}

// ── 摄像头就绪 ────────────────────────────────────────────
export function setVideoElement(videoEl) {
  if (els.video) {
    els.video.srcObject = videoEl;
  }
}

// ── 绘制识别框 ────────────────────────────────────────────
export function drawFrameOverlay(rect, videoSize, displaySize) {
  const canvas = els.canvas;
  if (!canvas || !displaySize) return;

  canvas.width = displaySize.width;
  canvas.height = displaySize.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 计算显示坐标（视频居中）
  const scale = Math.min(displaySize.width / videoSize.width, displaySize.height / videoSize.height);
  const dispW = videoSize.width * scale;
  const dispH = videoSize.height * scale;
  const offsetX = (displaySize.width - dispW) / 2;
  const offsetY = (displaySize.height - dispH) / 2;

  const scaleX = dispW / videoSize.width;
  const scaleY = dispH / videoSize.height;

  const dx = offsetX + rect.x * scaleX;
  const dy = offsetY + rect.y * scaleY;
  const dw = rect.width * scaleX;
  const dh = rect.height * scaleY;

  // 清空
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 绘制深色遮罩（框外区域），适度压暗以突出扫描区
  ctx.fillStyle = 'rgba(0, 0, 0, 0.70)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 擦除框内区域，恢复视频画面
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(dx, dy, dw, dh);
  ctx.globalCompositeOperation = 'source-over';

  // 在框内叠加淡淡的绿色提示底色
  ctx.fillStyle = 'rgba(74, 222, 128, 0.06)';
  ctx.fillRect(dx, dy, dw, dh);

  // 外边框 — 较粗的绿色实线
  ctx.strokeStyle = '#4ADE80';
  ctx.lineWidth = 3;
  ctx.strokeRect(dx, dy, dw, dh);

  // 四个角标（更粗更长，增强视觉识别度）
  const cornerLen = Math.max(20, Math.min(48, dw / 5, dh / 3));
  ctx.strokeStyle = '#4ADE80';
  ctx.lineWidth = 4;
  ctx.lineCap = 'square';

  const corners = [
    [dx, dy], [dx + dw, dy],
    [dx, dy + dh], [dx + dw, dy + dh],
  ];
  const cornerDirs = [
    [1, 1], [-1, 1],
    [1, -1], [-1, -1],
  ];

  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i];
    const [dx2, dy2] = cornerDirs[i];
    ctx.beginPath();
    ctx.moveTo(cx + dx2 * cornerLen, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy2 * cornerLen);
    ctx.stroke();
  }
}

// ── 显示识别结果 ──────────────────────────────────────────
export function showResult(result) {
  if (!els.resultContainer) return;

  if (result.success) {
    els.resultQuestion.textContent = result.question || '题目已识别';
    els.resultAnswer.textContent = result.answer || '';
    els.resultExplanation.textContent = result.explanation || '';
    els.resultSubject.textContent = result.subject || '';
    els.resultConfidence.textContent = result.confidence
      ? `置信度: ${(result.confidence * 100).toFixed(0)}%`
      : '';
    els.errorHint.textContent = '';
    els.resultContainer.className = 'result-container visible success';
  } else {
    const hint = getErrorHint(result.error_code);
    els.errorHint.textContent = hint;
    els.resultQuestion.textContent = '识别失败';
    els.resultAnswer.textContent = '';
    els.resultExplanation.textContent = '';
    els.resultSubject.textContent = '';
    els.resultConfidence.textContent = '';
    els.resultContainer.className = 'result-container visible error';
  }
}

/**
 * 显示题库匹配结果（仅展示题库数据，不调用 AI）。
 * @param {{question: object, matchType: string, confidence: number}} data
 */
export function showDatabaseResult(data) {
  if (!els.resultContainer || !data || !data.question) return;

  const q = data.question;
  els.resultQuestion.textContent = q.text || '题目已识别';
  els.resultAnswer.textContent = q.answer || '';
  els.resultExplanation.textContent = '';
  els.resultSubject.textContent = q.type === 'true_false' ? '判断题'
    : q.type === 'single_choice' ? '单选题'
    : q.type === 'multiple_choice' ? '多选题' : '';
  els.resultConfidence.textContent = data.confidence != null
    ? `匹配度: ${(data.confidence * 100).toFixed(0)}%` : '';

  // 来源标识
  const sourceEl = document.getElementById('result-source');
  if (sourceEl) {
    sourceEl.textContent = data.matchType === 'exact' ? '题库答案 · 精确匹配' : '题库答案 · 模糊匹配';
    sourceEl.style.display = 'inline';
  }

  els.errorHint.textContent = '';
  els.resultContainer.className = 'result-container visible success';
  console.log('[UI] showDatabaseResult:', data.matchType, data.confidence.toFixed(3));
}

export function hideResult() {
  if (els.resultContainer) {
    els.resultContainer.classList.remove('visible');
  }
}

// ── 显示错误状态 ──────────────────────────────────────────
export function showError(message) {
  if (els.statusText) els.statusText.textContent = '错误';
  if (els.statusSubtext) els.statusSubtext.textContent = message;
}

// ── 更新调试 FPS ──────────────────────────────────────────
export function updateDebugFPS(fps, change, hasContent, isStable, rect) {
  if (els.fpsCounter) {
    const rectInfo = rect ? ` | 框:(${rect.x},${rect.y}) ${rect.width}×${rect.height}` : '';
    els.fpsCounter.textContent = `FPS: ${fps} | 变化: ${(change * 100).toFixed(1)}% | 内容: ${hasContent} | 稳定: ${isStable}${rectInfo}`;
  }
}

// ── OCR 调试 ──────────────────────────────────────────────
export function showOCRDebug(result) {
  if (!els.ocrDebug) return;
  if (!result || !result.text) {
    els.ocrText.textContent = '(无识别结果)';
    els.ocrMeta.textContent = '';
    return;
  }
  els.ocrText.textContent = result.text || '(空)';
  const parts = [];
  if (result.elapsed != null) parts.push(`耗时 ${result.elapsed}ms`);
  if (result.confidence != null) parts.push(`置信 ${result.confidence.toFixed(1)}%`);
  if (result.error) parts.push('错误: ' + result.error);
  els.ocrMeta.textContent = parts.join('  ');
}

export function hideOCRDebug() {
  if (els.ocrDebug) els.ocrDebug.style.display = 'none';
}

export default {
  init,
  setVideoElement,
  drawFrameOverlay,
  showResult,
  showDatabaseResult,
  hideResult,
  showError,
  updateDebugFPS,
  showOCRDebug,
  hideOCRDebug,
};
