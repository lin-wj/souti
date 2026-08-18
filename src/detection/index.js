/**
 * 画面检测模块
 *
 * 职责：
 *   - 从视频流中抽取帧
 *   - 计算识别框区域内的图像特征
 *   - 检测画面变化（与上一帧比较）
 *   - 检测识别框内是否有有效内容（非纯色/空白）
 *   - 判断画面是否稳定
 */

import config from '../config.js';
import State, { getState } from '../state/machine.js';

// ── 内部状态 ──────────────────────────────────────────────
let lastFrameData = null;   // Uint8ClampedArray
let lastChangeTime = 0;     // 上次检测到变化的时间戳
let stableStart = null;     // 开始稳定的时间戳
let lastRecognizedHash = null; // 上次识别的图片 hash（用于去重）
let lastRecognitionTime = 0;  // 上次识别的时间戳
let frameCount = 0;
let totalProcessed = 0;

// ── 调试导出 ──────────────────────────────────────────────
export const _lastChange = { value: 0 };
export const _lastHasContent = { value: false };
export const _lastIsStable = { value: false };

// ── 回调 ─────────────────────────────────────────────────
let onContent = null;   // (hasContent) => void
let onStable = null;    // () => void
let onChange = null;    // () => void
let onFrameProcessed = null; // ({ change, hasContent, fps }) => void

export function onDetectContent(fn) {
  onContent = fn;
}

export function onDetectStable(fn) {
  onStable = fn;
}

export function onDetectChange(fn) {
  onChange = fn;
}

export function onFrameProcessedCallback(fn) {
  onFrameProcessed = fn;
}

/**
 * 重置检测状态（当识别成功后调用，进入等待变化模式）。
 */
export function resetDetection() {
  lastFrameData = null;
  stableStart = null;
  lastRecognizedHash = null;
  lastRecognitionTime = Date.now();
}

/**
 * 标记当前帧已被识别，用于冷却时间控制。
 */
export function markRecognized(hash) {
  lastRecognizedHash = hash;
  lastRecognitionTime = Date.now();
}

/**
 * 从视频元素截取指定区域的帧数据。
 * @param {HTMLVideoElement} video
 * @param {{x, y, width, height}} rect — 识别框在画布上的像素坐标
 * @returns {Uint8ClampedArray|null} RGBA 像素数据，失败返回 null
 */
export function captureFrame(video, rect) {
  try {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // 确保 canvas 尺寸匹配识别区域
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
 * 判断识别框内是否存在有效内容（非纯色/空白页）。
 * 使用方差 + 边缘检测启发式判断。
 */
export function hasContent(pixelData, width, height) {
  if (!pixelData || pixelData.length < 4) return false;

  let rSum = 0, gSum = 0, bSum = 0;
  let rVar = 0, gVar = 0, bVar = 0;
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 10000)); // 抽样加速

  for (let i = 0; i < pixelData.length; i += 4 * step) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];
    rSum += r; gSum += g; bSum += b;
  }

  const samples = Math.ceil(n / step);
  const rMean = rSum / samples;
  const gMean = gSum / samples;
  const bMean = bSum / samples;

  let rVarSum = 0, gVarSum = 0, bVarSum = 0;
  for (let i = 0; i < pixelData.length; i += 4 * step) {
    rVarSum += (pixelData[i] - rMean) ** 2;
    gVarSum += (pixelData[i + 1] - gMean) ** 2;
    bVarSum += (pixelData[i + 2] - bMean) ** 2;
  }

  rVar = rVarSum / samples;
  gVar = gVarSum / samples;
  bVar = bVarSum / samples;

  const avgVar = (rVar + gVar + bVar) / 3;

  // 方差过低 = 纯色/空白；过高 = 可能模糊
  // 典型纸张题目：方差适中
  return avgVar > 50 && avgVar < 50000;
}

/**
 * 计算两帧之间的差异比例（0–1）。
 * 使用像素差分 + 归一化。
 */
export function computeFrameDifference(prev, curr, w, h) {
  if (!prev || !curr) return 1.0;
  const maxPixels = w * h;
  let diff = 0;
  const step = 4; // 每 4 字节一个像素

  for (let i = 0; i < prev.length && i < curr.length; i += 12) { // 跳步加速
    diff += Math.abs(prev[i] - curr[i])
          + Math.abs(prev[i + 1] - curr[i + 1])
          + Math.abs(prev[i + 2] - curr[i + 2]);
  }

  const samples = Math.ceil(prev.length / 12);
  const maxDiff = samples * 3 * 255;
  return diff / maxDiff;
}

/**
 * 对图像生成简单的感知 hash（64-bit pHash 简化版）。
 * 用于检测同一道题的重复识别。
 */
export function computePerceptualHash(pixelData, width, height) {
  try {
    const canvas = getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 缩放到小尺寸
    const size = 16;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(toImageBitmapSync(pixelData, width, height), 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    // 转灰度并计算平均值
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
    return null;
  }
}

/**
 * 比较两个 hash 的汉明距离，返回相似比例（0=完全不同，1=完全相同）。
 */
export function hashSimilarity(hashA, hashB) {
  if (!hashA || !hashB) return null;
  if (hashA.length !== hashB.length) return null;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) diff++;
  }
  return 1 - diff / hashA.length;
}

/**
 * 主检测循环 — 由调用方每 FRAME_INTERVAL ms 调用一次。
 * @param {HTMLVideoElement} video
 * @param {{x, y, width, height}} rect — 识别框像素坐标
 */
export function processFrame(video, rect) {
  if (getState() === State.PROCESSING || getState() === State.CAPTURING) return;

  // 冷却时间内跳过
  const now = Date.now();
  if (now - lastRecognitionTime < config.COOLDOWN_TIME) {
    return;
  }

  const pixelData = captureFrame(video, rect);
  if (!pixelData) return;

  const { width, height } = rect;
  totalProcessed++;
  frameCount++;

  // ── 检测是否有内容 ──────────────────────────────────────
  const content = hasContent(pixelData, width, height);
  if (onContent) onContent(content);
  _lastHasContent.value = content;

  // ── 检测画面变化 ────────────────────────────────────────
  let change = 0;
  if (lastFrameData) {
    change = computeFrameDifference(lastFrameData, pixelData, width, height);
  }
  _lastChange.value = change;

  if (change > config.CHANGE_THRESHOLD) {
    lastChangeTime = now;
    stableStart = null; // 变化了，重置稳定计时
    if (onChange) onChange(change);
  }

  // ── 稳定检测 ────────────────────────────────────────────
  if (!stableStart && content && change <= config.CHANGE_THRESHOLD) {
    stableStart = now;
  }

  if (stableStart && now - stableStart >= config.STABLE_DURATION) {
    if (onStable) onStable();
    stableStart = now; // 防重复触发
  }
  _lastIsStable.value = !!(stableStart && now - stableStart >= config.STABLE_DURATION);

  // 更新上一帧
  lastFrameData = pixelData;

  // ── 通知处理结果（调试用）───────────────────────────────
  if (onFrameProcessed) {
    onFrameProcessed({
      change,
      hasContent: content,
      isStable: !!stableStart && now - stableStart >= config.STABLE_DURATION,
      fps: Math.round(1000 / config.FRAME_INTERVAL),
    });
  }
}

/**
 * 检查是否满足触发识别的条件。
 */
export function isReadyToCapture(video, rect) {
  const now = Date.now();
  const content = hasContent(lastFrameData, rect.width, rect.height);
  const change = lastFrameData ? computeFrameDifference(null, lastFrameData, rect.width, rect.height) : 0;
  const inCooldown = now - lastRecognitionTime < config.COOLDOWN_TIME;
  const isStable = stableStart && now - stableStart >= config.STABLE_DURATION;

  return content && !inCooldown && isStable;
}

/**
 * 计算识别框在摄像头画面中的像素坐标。
 * @param {{width, height}} videoSize — 视频实际分辨率
 * @param {{width, height}} displaySize — 视频在页面上的显示尺寸
 * @returns {{x, y, width, height}}
 */
export function computeRect(videoSize, displaySize) {
  const { width: vw, height: vh } = videoSize;
  const { width: dw, height: dh } = displaySize;

  // 保持视频原始宽高比，计算显示区域的实际尺寸
  const scale = Math.min(dw / vw, dh / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;

  // 居中偏移
  const offsetX = (dw - dispW) / 2;
  const offsetY = (dh - dispH) / 2;

  // 识别框相对于视频内容的坐标
  const frameW = dispW * config.FRAME_WIDTH_RATIO;
  const frameH = dispH * config.FRAME_HEIGHT_RATIO;
  const frameX = offsetX + (dispW - frameW) / 2;
  const frameY = offsetY + (dispH - frameH) / 2;

  // 映射到视频原始分辨率
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

/** 将像素数据转为 ImageBitmap（异步，兼容性回退）。 */
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
  resetDetection,
  markRecognized,
  onDetectContent,
  onDetectStable,
  onDetectChange,
  onFrameProcessedCallback,
};
