/**
 * OCR 预处理模块
 *
 * 职责：
 *   - 对 canvas 图像进行预处理，提升 Tesseract 识别率
 *   - 提供多策略预处理链
 *   - 失败时 fallback 到原图
 *
 * 策略：
 *   1. raw      — 原图直出（baseline）
 *   2. gray     — 灰度化 + 对比度增强
 *   3. gray+bin — 灰度 + 对比度 + 自适应二值化
 *
 * 所有操作在 CPU 上完成，使用 Canvas 2D API。
 */

/**
 * 将 canvas 转为灰度并增强对比度。
 * @param {HTMLCanvasElement} src
 * @param {number} [contrast=1.5] — 对比度倍数（1.0 = 不变）
 * @param {number} [brightness=0] — 亮度偏移（-128 ~ 127）
 * @returns {HTMLCanvasElement}
 */
export function grayAndEnhance(src, contrast = 1.5, brightness = 0) {
  const { width, height } = src;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;

  ctx.drawImage(src, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 对比度因子：259 * (contrast + 1) / (259 - contrast)
  const factor = (259 * (contrast + 1)) / (259 - contrast);

  for (let i = 0; i < data.length; i += 4) {
    // 灰度
    let r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // 对比度增强 + 亮度偏移
    const enhanced = Math.min(255, Math.max(0, factor * (gray - 128) + 128 + brightness));

    data[i] = data[i + 1] = data[i + 2] = enhanced;
    // alpha 保持不变
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 对灰度图进行自适应二值化（简单阈值 + 局部自适应）。
 * @param {HTMLCanvasElement} grayCanvas — 灰度图
 * @param {number} [threshold=128] — 全局阈值
 * @param {number} [localWindow=11] — 局部自适应窗口大小（奇数）
 * @returns {HTMLCanvasElement}
 */
export function adaptiveBinary(grayCanvas, threshold = 128, localWindow = 11) {
  const { width, height } = grayCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return grayCanvas;

  const srcData = ctx.getImageData(0, 0, width, height);
  // 先读灰度图数据
  const grayCtx = grayCanvas.getContext('2d', { willReadFrequently: true });
  const grayData = grayCtx.getImageData(0, 0, width, height).data;

  const halfW = Math.floor(localWindow / 2);
  const pixels = canvas.getContext('2d').createImageData(width, height);
  const d = pixels.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 局部自适应阈值
      let localSum = 0, localCount = 0;
      for (let dy = -halfW; dy <= halfW; dy++) {
        for (let dx = -halfW; dx <= halfW; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const idx = (ny * width + nx) * 4;
            localSum += grayData[idx];
            localCount++;
          }
        }
      }
      const localThreshold = (localSum / localCount) * 0.9; // 稍微降低阈值以保留更多文字

      const idx = (y * width + x) * 4;
      const gray = grayData[idx];
      const val = gray > localThreshold ? 255 : 0;
      d[idx] = d[idx + 1] = d[idx + 2] = val;
      d[idx + 3] = 255;
    }
  }

  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * 对图像进行 2 倍放大（双线性插值），提升小字识别率。
 * @param {HTMLCanvasElement} src
 * @returns {HTMLCanvasElement}
 */
export function upscale2x(src) {
  const canvas = document.createElement('canvas');
  canvas.width = src.width * 2;
  canvas.height = src.height * 2;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * 完整的预处理流水线：放大 → 灰度 → 对比度增强 → 二值化（可选）
 * @param {HTMLCanvasElement} src
 * @param {object} options
 * @returns {HTMLCanvasElement}
 */
export function preprocess(src, options = {}) {
  const {
    upscale = true,          // 是否 2x 放大
    contrast = 1.8,          // 对比度增强倍数
    brightness = 10,         // 亮度偏移
    binary = false,          // 是否二值化
    binaryThreshold = 128,   // 二值化阈值
    localWindow = 11,        // 局部自适应窗口
  } = options;

  try {
    let result = src;
    if (upscale) result = upscale2x(result);
    result = grayAndEnhance(result, contrast, brightness);
    if (binary) result = adaptiveBinary(result, binaryThreshold, localWindow);
    return result;
  } catch (err) {
    console.warn('[OCR] preprocessing failed, falling back to original:', err);
    return src;
  }
}

/**
 * 生成处理前后对比图（用于调试显示）。
 * @param {HTMLCanvasElement} original
 * @param {HTMLCanvasElement} processed
 * @returns {HTMLCanvasElement} — 左右拼接的对比图
 */
export function createComparisonCanvas(original, processed) {
  const w = original.width + processed.width;
  const h = Math.max(original.height, processed.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(original, 0, 0);
  ctx.drawImage(processed, original.width, 0);
  return canvas;
}

export default { preprocess, grayAndEnhance, adaptiveBinary, upscale2x, createComparisonCanvas };
