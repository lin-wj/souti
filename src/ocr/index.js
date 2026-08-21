/**
 * OCR 模块 — 独立封装，可替换任何 OCR 引擎
 *
 * 接口：
 *   OCR.init()          — 懒加载初始化，返回 Promise
 *   OCR.recognize(img)  — 识别图片（canvas/video/ImageData），返回 { text, confidence, elapsed }
 *   OCR.destroy()       — 释放资源
 *
 * 当前实现：Tesseract.js v5
 * 未来替换时只需修改此文件内部实现，外部调用方不受影响。
 */

// ── Tesseract.js 动态加载 ──────────────────────────────────
// 通过全局 Tesseract 变量接入（由 index.html 的 <script> 注入）
// 不直接 import，保证模块可被其他 OCR 实现完全替换
let _worker = null;
let _initPromise = null;
let _initialized = false;

const TESSERACT_CDN =
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

/**
 * 懒加载 Tesseract.js 脚本（仅加载一次）。
 */
async function loadTesseractScript() {
  if (typeof Tesseract !== 'undefined') return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Tesseract.js 加载失败，请检查网络'));
    document.head.appendChild(s);
  });
}

/**
 * 初始化 Tesseract worker（首次调用时触发）。
 * 加载中英文语言包（约 12MB），仅首次耗时。
 */
export async function init() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    await loadTesseractScript();
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js 未成功加载');
    }
    _worker = await Tesseract.createWorker('chi_sim+eng', 1, {
      // 性能选项：平衡速度与精度
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.debug('[OCR] 识别进度:', Math.round(m.progress * 100) + '%');
        }
      },
    });
    _initialized = true;
    console.info('[OCR] 初始化完成，语言包: chi_sim+eng');
  })();

  return _initPromise;
}

/**
 * 识别图片，返回 { text, confidence, elapsed }。
 * @param {HTMLCanvasElement|HTMLVideoElement|HTMLImageElement|ImageBitmap} img
 * @returns {Promise<{text: string, confidence: number|null, elapsed: number}>}
 */
export async function recognize(img) {
  const start = performance.now();

  // 确保 worker 已初始化
  if (!_initialized) {
    await init();
  }

  if (!_worker) {
    throw new Error('OCR worker 未初始化，请先调用 OCR.init()');
  }

  try {
    const result = await _worker.recognize(img);
    const elapsed = Math.round(performance.now() - start);

    return {
      text: (result?.data?.text ?? '').trim(),
      confidence: result?.data?.confidence ?? null,
      elapsed,
    };
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    console.error('[OCR] 识别失败:', err);
    return { text: '', confidence: null, elapsed, error: err.message };
  }
}

/**
 * 释放 Tesseract worker 资源。
 */
export function destroy() {
  if (_worker) {
    _worker.terminate().catch(() => {});
    _worker = null;
  }
  _initialized = false;
  _initPromise = null;
  console.info('[OCR] 已释放');
}

/**
 * 获取当前初始化状态。
 */
export function isInitialized() {
  return _initialized;
}

export default { init, recognize, destroy, isInitialized };
