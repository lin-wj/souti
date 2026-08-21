/**
 * 画面检测模块 — 重构版
 *
 * 检测流程：
 *   NO_CONTENT → CONTENT_DETECTED → STABLE(count) → CAPTURING
 *
 * 触发条件：
 *   1. 检测到有效内容（方差 > 阈值）
 *   2. 连续 N 帧相似（变化 < 阈值）
 *   3. 冷却时间已过（防止重复识别同一题）
 *   4. 不在处理中状态
 *
 * 防重复机制：
 *   - 使用 perceptual hash 比较当前帧与上一识别帧
 *   - hash 相似度 > 0.85 时跳过（同一道题轻微晃动）
 *   - 冷却时间 COOLDOWN_TIME 内不触发
 */

import config from '../config.js';
import State from '../state/machine.js';
import { getState } from '../state/store.js';

// ── 内部状态 ──────────────────────────────────────────────
let lastFrameData = null;           // 上一帧像素数据（用于变化检测）
let lastFrameHash = null;           // 上一帧的 perceptual hash（用于去重）
let lastRecognizedFrameData = null; // 上次成功识别时的帧数据（用于换题检测）
let lastRecognizedHash = null;      // 上次成功识别的 hash（用于重复识别判断）
let lastRecognizedTime = 0;         // 上次成功识别的时间（用于 changeFromRecognized 计算）
let stableCount = 0;                // 当前连续相似帧计数
let lastChangeTime = 0;             // 上次检测到明显变化的时间戳
let lastRecognitionTime = 0;        // 上次触发识别的时间戳（冷却计时）
let frameCount = 0;                 // 总帧计数（调试用）
let totalProcessed = 0;             // 成功处理的帧数（调试用）

// ── 调试导出 ──────────────────────────────────────────────
export const _lastChange = { value: 0 };
export const _lastHasContent = { value: false };
export const _lastIsStable = { value: false };
export const _stableCount = { value: 0 };
export const _lastRecognizedHash = { value: null };
export const _lastRecognitionTime = { value: 0 };
export const _lastRecognizedFrameData = { value: null };
export const _changeFromRecognized = { value: 0 };
export const _questionChanged = { value: false };

// ── 回调 ─────────────────────────────────────────────────
let onContent = null;
let onStable = null;
let onChange = null;
let onFrameProcessed = null;

export function onDetectContent(fn) { onContent = fn; }
export function onDetectStable(fn) { onStable = fn; }
export function onDetectChange(fn) { onChange = fn; }
export function onFrameProcessedCallback(fn) { onFrameProcessed = fn; }

/**
 * 重置检测状态（识别成功后调用）。
 * 注意：不清除 lastFrameData，保持变化检测连续性。
 * 只清除 lastRecognizedFrameData，允许新题目触发识别。
 */
export function resetDetection() {
  // 不清除 lastFrameData — 保持与上一帧的变化检测连续性
  // 不清除 lastFrameHash — 用于后续帧的重复判断
  // 不清除 lastRecognizedHash — 防止同一道题重复识别
  stableCount = 0;
  lastRecognitionTime = Date.now();
  // lastRecognizedFrameData 在换题时由 isReadyToCapture 清除
  console.log('[Detection] resetDetection: stableCount reset, cooldown started');
}

/**
 * 标记当前帧已被识别，更新冷却时间和 hash。
 * 同时保存当前帧作为"已识别帧"，用于后续重复判断。
 */
export function markRecognized(hash) {
  // 只有成功 capture 后才设置已识别 hash
  lastRecognizedHash = hash;
  lastRecognizedFrameData = null; // 清除候选帧，等待新题目
  lastRecognitionTime = Date.now();
  lastRecognizedTime = Date.now(); // 记录识别时间用于 changeFromRecognized
  _lastRecognizedHash.value = hash;
  _lastRecognitionTime.value = lastRecognitionTime;
  _changeFromRecognized.value = 0;
  _questionChanged.value = false;
  console.log('[Detection] markRecognized: hash=', hash?.substring(0, 8), 'cooldownUntil=', lastRecognitionTime + config.COOLDOWN_TIME);
}

/**
 * 从视频元素截取指定区域的帧数据。
 */
export function captureFrame(video, rect) {
  try {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return ctx.getImageData(0, 0, rect.width, rect.height).data;
  } catch (e) {
    console.error('[Detection] captureFrame error:', e);
    return null;
  }
}

/**
 * 判断识别框内是否存在有效内容。
 * 使用 RGB 方差判断：白纸黑字方差适中，纯色/空白方差低。
 */
export function hasContent(pixelData, width, height) {
  if (!pixelData || pixelData.length < 16) return false;

  const n = width * height;
  const step = Math.max(1, Math.floor(n / 5000)); // 抽样加速

  // 计算均值
  let rSum = 0, gSum = 0, bSum = 0;
  let count = 0;
  for (let i = 0; i < pixelData.length; i += 4 * step) {
    rSum += pixelData[i];
    gSum += pixelData[i + 1];
    bSum += pixelData[i + 2];
    count++;
  }
  if (count === 0) return false;

  const rMean = rSum / count;
  const gMean = gSum / count;
  const bMean = bSum / count;

  // 计算方差
  let rVar = 0, gVar = 0, bVar = 0;
  for (let i = 0; i < pixelData.length; i += 4 * step) {
    rVar += (pixelData[i] - rMean) ** 2;
    gVar += (pixelData[i + 1] - gMean) ** 2;
    bVar += (pixelData[i + 2] - bMean) ** 2;
  }
  rVar /= count; gVar /= count; bVar /= count;
  const avgVar = (rVar + gVar + bVar) / 3;

  // 白纸黑字题目：方差约 1000–20000
  // 纯白/纯黑页面：方差 < 50
  // 模糊/噪点严重：方差可能 > 50000
  return avgVar > 80 && avgVar < 40000;
}

/**
 * 计算两帧之间的差异比例（0–1）。
 * 使用采样像素的 RGB 绝对差之和归一化。
 * step=12 表示每 3 个像素取 1 个样本，平衡速度与灵敏度。
 */
export function computeFrameDifference(prev, curr, w, h) {
  if (!prev || !curr) return 1.0;
  let diff = 0;
  const totalSamples = Math.min(prev.length, curr.length);

  // 使用较大的步长（12字节=3像素）来加速比较
  for (let i = 0; i < totalSamples; i += 12) {
    diff += Math.abs(prev[i] - curr[i])
          + Math.abs(prev[i + 1] - curr[i + 1])
          + Math.abs(prev[i + 2] - curr[i + 2]);
  }

  const samples = Math.ceil(totalSamples / 12);
  const maxDiff = samples * 3 * 255;
  return maxDiff > 0 ? diff / maxDiff : 0;
}

/**
 * 对图像生成感知 hash（16x16 = 256 bit）。
 * 用于检测同一道题的重复识别。
 */
export function computePerceptualHash(pixelData, width, height) {
  try {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const size = 16;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(toImageBitmapSync(pixelData, width, height), 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    // 计算灰度平均值作为阈值
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    const avg = sum / (size * size);

    // 生成 hash 字符串
    let hash = '';
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      hash += gray > avg ? '1' : '0';
    }
    return hash;
  } catch (e) {
    console.warn('[Detection] computePerceptualHash error:', e);
    return null;
  }
}

/**
 * 比较两个 hash 的汉明距离，返回相似比例（0=完全不同，1=完全相同）。
 */
export function hashSimilarity(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return null;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) diff++;
  }
  return 1 - diff / hashA.length;
}

/**
 * 主检测函数 — 由调用方每 FRAME_INTERVAL ms 调用一次。
 * 不改变状态机状态，只更新内部检测状态。
 *
 * @param {HTMLVideoElement} video
 * @param {{x, y, width, height}} rect — 识别框在视频原始分辨率下的坐标
 */
export function processFrame(video, rect) {
  const state = getState();
  // 处理中的状态不进行检测（防止干扰）
  if (state === State.PROCESSING || state === State.CAPTURING || state === State.MATCHING) {
    return;
  }

  // 冷却时间内跳过检测（减少不必要的计算）
  const now = Date.now();
  if (now - lastRecognitionTime < config.COOLDOWN_TIME) {
    return;
  }

  const pixelData = captureFrame(video, rect);
  if (!pixelData) return;

  const { width, height } = rect;
  totalProcessed++;
  frameCount++;

  // ── 1. 内容检测 ────────────────────────────────────────
  const content = hasContent(pixelData, width, height);
  _lastHasContent.value = content;
  if (onContent) onContent(content);

  // ── 2. 帧差异检测 ──────────────────────────────────────
  let change = 0;
  if (lastFrameData) {
    change = computeFrameDifference(lastFrameData, pixelData, width, height);
  }
  _lastChange.value = change;

  // ── 3. 稳定计数逻辑（核心变更）─────────────────────────
  // 如果检测到内容且变化较小，增加稳定计数
  // 如果变化较大，重置稳定计数
  if (content) {
    if (change <= config.CHANGE_THRESHOLD) {
      // 帧相似，增加稳定计数
      stableCount++;
    } else {
      // 帧差异大，重置
      stableCount = 0;
      lastChangeTime = now;
      if (onChange) onChange(change);
    }
  } else {
    // 无内容，重置
    stableCount = 0;
  }
  _stableCount.value = stableCount;

  // 稳定指示器：当稳定计数接近目标时标记为稳定
  const isStable = stableCount >= config.STABLE_FRAME_COUNT - 1;
  _lastIsStable.value = isStable;
  
  // ── 换题检测：比较当前帧与已识别帧的差异 ──
  let questionChanged = false;
  if (lastRecognizedHash && lastRecognizedTime > 0) {
    // 计算当前帧与已识别帧的差异
    const changeFromRecognized = computeFrameDifference(lastRecognizedFrameData, pixelData, width, height);
    _changeFromRecognized.value = changeFromRecognized;
    
    // 如果与已识别帧差异明显（> CHANGE_THRESHOLD），认为是新题目
    if (changeFromRecognized > config.CHANGE_THRESHOLD) {
      questionChanged = true;
      lastRecognizedHash = null;
      lastRecognizedFrameData = null;
      _questionChanged.value = true;
      console.log('[Detection] question changed (changeFromRecognized=' + (changeFromRecognized * 100).toFixed(1) + '%)');
    }
  } else {
    _changeFromRecognized.value = 0;
    _questionChanged.value = false;
  }

  // ── 4. 通知回调 ────────────────────────────────────────
  if (onFrameProcessed) {
    onFrameProcessed({
      change,
      hasContent: content,
      isStable,
      stableCount,
      fps: Math.round(1000 / config.FRAME_INTERVAL),
    });
  }

  // 更新上一帧
  lastFrameData = pixelData;
}

/**
 * 检查是否满足触发识别的条件。
 * 必须在 processFrame() 之后调用。
 *
 * 触发条件：
 *   1. 不在处理中状态
 *   2. 冷却时间已过
 *   3. 检测到内容
 *   4. 连续稳定帧数达标
 *   5. 与上一识别帧不完全相同（防重复）
 */
export function isReadyToCapture(video, rect) {
  const now = Date.now();
  const state = getState();

  // 条件 1：不在处理中
  if (state === State.PROCESSING || state === State.CAPTURING || state === State.MATCHING) {
    return { ready: false, reason: 'processing' };
  }

  // 条件 2：冷却时间
  if (now - lastRecognitionTime < config.COOLDOWN_TIME) {
    const remaining = Math.ceil((config.COOLDOWN_TIME - (now - lastRecognitionTime)) / 1000);
    return { ready: false, reason: 'cooldown', remaining };
  }

  // 条件 3 & 4：内容和稳定
  const content = hasContent(lastFrameData, rect.width, rect.height);
  const isStable = stableCount >= config.STABLE_FRAME_COUNT - 1;

  if (!content) {
    return { ready: false, reason: 'no_content' };
  }
  if (!isStable) {
    return { ready: false, reason: 'not_stable', stableCount, required: config.STABLE_FRAME_COUNT - 1 };
  }

  // 条件 5：防重复（hash 相似度检查）
  // 只有当 lastRecognizedHash 存在且 question 未变化时才检查
  // 第一次识别时 lastRecognizedHash = null，直接允许
  // 换题后 questionChanged=true，lastRecognizedHash=null，也直接允许
  if (lastRecognizedHash && !questionChanged) {
    const currentHash = computePerceptualHash(lastFrameData, rect.width, rect.height);
    if (currentHash) {
      const similarity = hashSimilarity(lastRecognizedHash, currentHash);
      if (similarity !== null && similarity > 0.90) {
        return { ready: false, reason: 'duplicate', similarity: similarity.toFixed(3) };
      }
      // 相似度低说明是新题目，清除锁定状态
      if (similarity < 0.7) {
        lastRecognizedHash = null;
        lastRecognizedFrameData = null;
      }
    }
  }

  return { ready: true, stableCount, change: _lastChange.value };
}

/**
 * 计算识别框在摄像头画面中的像素坐标。
 * 与 UI.drawFrameOverlay 使用相同的坐标映射逻辑。
 */
export function computeRect(videoSize, displaySize) {
  const { width: vw, height: vh } = videoSize;
  const { width: dw, height: dh } = displaySize;

  const scale = Math.min(dw / vw, dh / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;

  const offsetX = (dw - dispW) / 2;
  const offsetY = (dh - dispH) / 2;

  const frameW = dispW * config.FRAME_WIDTH_RATIO;
  const frameH = dispH * config.FRAME_HEIGHT_RATIO;
  const frameX = offsetX + (dispW - frameW) / 2;
  const frameY = offsetY + (dispH - frameH) / 2;

  const scaleX = vw / dispW;
  const scaleY = vh / dispH;

  return {
    x: Math.round(frameX * scaleX),
    y: Math.round(frameY * scaleY),
    width: Math.round(frameW * scaleX),
    height: Math.round(frameH * scaleY),
  };
}

// ── 工具函数 ──────────────────────────────────────────────
let _canvas = null;
function getCanvas() {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
  }
  return _canvas;
}

export function toImageBitmapSync(pixelData, width, height) {
  const canvas = getCanvas();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixelData);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export default {
  processFrame,
  computeFrameDifference,
  hasContent,
  computePerceptualHash,
  hashSimilarity,
  computeRect,
  isReadyToCapture,
  captureFrameForHash: captureFrame,
  resetDetection,
  markRecognized,
  onDetectContent,
  onDetectStable,
  onDetectChange,
  onFrameProcessedCallback,
  _lastRecognizedHash,
  _lastRecognitionTime,
  _lastRecognizedFrameData,
  _changeFromRecognized,
  _questionChanged,
};
