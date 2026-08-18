/**
 * 图片处理模块
 *
 * 职责：
 *   - 从 Canvas 截取识别区域
 *   - 缩放至目标尺寸
 *   - 压缩为 JPEG/WebP Blob
 *   - 生成 Base64（供 AI 请求使用）
 */

import config from '../config.js';

/**
 * 截取视频帧中指定区域，缩放并压缩为 Blob。
 * @param {HTMLVideoElement} video
 * @param {{x, y, width, height}} rect — 识别框在视频原始分辨率下的坐标
 * @returns {Promise<{blob: Blob, base64: string, width: number, height: number}>}
 */
export async function extractAndCompress(video, rect) {
  const { x, y, width, height } = rect;

  // 创建临时 canvas 截取区域
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // 截取识别框区域
  ctx.drawImage(video, x, y, width, height, 0, 0, width, height);

  // 缩放
  const targetW = config.TARGET_WIDTH;
  const scale = targetW / width;
  const targetH = Math.round(height * scale);

  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = targetW;
  scaledCanvas.height = targetH;
  const sctx = scaledCanvas.getContext('2d');
  if (!sctx) throw new Error('Failed to get scaled canvas context');

  sctx.drawImage(canvas, 0, 0, targetW, targetH);

  // 压缩为 JPEG blob
  const blob = await new Promise((resolve, reject) => {
    scaledCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      config.IMAGE_QUALITY,
    );
  });

  // 生成 base64 供 AI 使用
  const base64 = await blobToBase64(blob);

  return { blob, base64, width: targetW, height: targetH };
}

/**
 * 将 Blob 转为 base64 字符串（含 MIME type 前缀）。
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 将像素数据（Uint8ClampedArray）转为 JPEG Blob。
 */
export function pixelsToBlob(pixelData, width, height) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('No context')); return; }

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixelData);
    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      config.IMAGE_QUALITY,
    );
  });
}

export default {
  extractAndCompress,
  blobToBase64,
  pixelsToBlob,
};
