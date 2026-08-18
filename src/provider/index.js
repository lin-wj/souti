/**
 * AI Provider 层 — 统一接口，业务代码不直接依赖具体模型
 *
 * 支持的后端实现：
 *   - Cloudflare Workers AI（默认，第一阶段）
 *   - OpenAI（可替换）
 *   - Anthropic（可替换）
 *
 * 第一阶段只实现 Cloudflare Worker 代理方式。
 */

import config from '../config.js';

/**
 * AI 识别结果的结构化类型。
 * @typedef {Object} QuestionResult
 * @property {boolean} success
 * @property {string} [question] — 识别到的题目文本
 * @property {string} [subject] — 科目（math/chinese/english/...）
 * @property {string} [question_type] — 题型
 * @property {string} [answer] — 答案
 * @property {string} [explanation] — 解析
 * @property {number} [confidence] — 置信度 0–1
 * @property {string} [error] — 错误原因
 * @property {string} [error_code] — 错误码
 */

/**
 * 错误码常量
 */
export const ErrorCode = Object.freeze({
  SUCCESS: 'success',
  NO_QUESTION: 'no_question',
  BLURRY: 'blurry',
  INCOMPLETE: 'incomplete',
  TOO_SMALL: 'too_small',
  AI_FAILED: 'ai_failed',
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
});

/**
 * 调用 AI 识题的统一接口。
 * @param {string} base64Image — JPEG base64 数据
 * @param {AbortSignal} [signal] — 可选的 AbortSignal
 * @returns {Promise<QuestionResult>}
 */
export async function solveQuestion(base64Image, signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.AI_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const resp = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      return {
        success: false,
        error: `HTTP ${resp.status}`,
        error_code: ErrorCode.NETWORK_ERROR,
      };
    }

    const data = await resp.json();
    return normalizeResult(data);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'AI 请求超时',
        error_code: ErrorCode.TIMEOUT,
      };
    }
    return {
      success: false,
      error: err.message || 'AI 请求失败',
      error_code: ErrorCode.NETWORK_ERROR,
    };
  }
}

/**
 * 将 Worker 返回的数据规范化为标准结构。
 */
function normalizeResult(data) {
  if (data.success === false) {
    return {
      success: false,
      error: data.error || 'AI 识别失败',
      error_code: data.error_code || ErrorCode.AI_FAILED,
    };
  }
  return {
    success: true,
    question: data.question ?? '',
    subject: data.subject ?? '',
    question_type: data.question_type ?? '',
    answer: data.answer ?? '',
    explanation: data.explanation ?? '',
    confidence: data.confidence ?? 0,
  };
}

/**
 * 获取用户友好的错误提示文本。
 */
export function getErrorHint(errorCode) {
  const hints = {
    [ErrorCode.NO_QUESTION]: '未检测到完整题目，请将题目整体放入识别框内',
    [ErrorCode.BLURRY]: '画面有些模糊，请保持手机稳定',
    [ErrorCode.INCOMPLETE]: '题目没有完整进入识别框',
    [ErrorCode.TOO_SMALL]: '题目文字太小，请靠近一些',
    [ErrorCode.AI_FAILED]: 'AI 暂时无法解析这道题，请重试',
    [ErrorCode.TIMEOUT]: '识别超时，请检查网络后重试',
    [ErrorCode.NETWORK_ERROR]: '网络连接异常，请检查网络后重试',
    [ErrorCode.UNKNOWN]: '识别出错，请重试',
  };
  return hints[errorCode] ?? hints[ErrorCode.UNKNOWN];
}

export default { solveQuestion, getErrorHint, ErrorCode };
