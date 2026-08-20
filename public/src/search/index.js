/**
 * 题库搜索引擎
 *
 * 策略：
 *   第一层：精确匹配
 *     normalize(OCR文本) === normalize(题库题干)
 *
 *   第二层：候选匹配（n-gram 相似度排序）
 *     提取关键词 → 在题库中查找包含关键词的题目 → 计算相似度 → 返回最高分
 *
 *   第三层：无匹配
 *     返回 null，由上层决定是否调用 AI 兜底
 *
 * 性能：
 *   - 内存中维护 normalizedIndex: Map<normalizedText, Question>
 *   - 题库约 1000 题，线性扫描完全可接受
 *   - 不引入复杂索引结构
 */

import { normalize, extractKeywords, ngramSimilarity } from '../utils/normalize.js';
import Storage from '../db/storage.js';

// ── 内存索引 ──────────────────────────────────────────────
let normalizedIndex = null; // Map<normalizedText, Question>
let allQuestions = null;    // Question[] (原始顺序，用于 n-gram 搜索)
let indexBuilt = false;

/**
 * 构建/更新内存索引（从 IndexedDB 加载）。
 */
export async function buildIndex() {
  const questions = await Storage.getAllQuestions();
  allQuestions = questions;
  normalizedIndex = new Map();

  for (const q of questions) {
    const key = normalize(q.text);
    if (key && !normalizedIndex.has(key)) {
      normalizedIndex.set(key, q);
    }
  }

  indexBuilt = true;
  console.info(`[Search] 索引已构建，共 ${questions.length} 道题`);
  return questions.length;
}

/**
 * 搜索题目。
 * @param {string} ocrText — OCR 识别到的原始文本
 * @returns {Promise<{question: Question|null, matchType: 'exact'|'fuzzy'|'none', confidence: number}>}
 */
export async function search(ocrText) {
  if (!indexBuilt) {
    await buildIndex();
  }

  if (!ocrText || !normalizedIndex) {
    return { question: null, matchType: 'none', confidence: 0 };
  }

  const query = normalize(ocrText);

  // ── 第一层：精确匹配 ────────────────────────────────────
  const exact = normalizedIndex.get(query);
  if (exact) {
    console.log(`[Search] 精确匹配成功: "${query.substring(0, 30)}..."`);
    return { question: exact, matchType: 'exact', confidence: 1.0 };
  }

  // ── 第二层：候选匹配（n-gram 相似度）───────────────────
  const keywords = extractKeywords(query, 2);
  if (keywords.length === 0) {
    return { question: null, matchType: 'none', confidence: 0 };
  }

  // 收集所有候选题目
  const candidates = new Map(); // questionId → {score, matchCount}
  const allQs = allQuestions || [];

  for (const kw of keywords) {
    for (const q of allQs) {
      const normQ = normalize(q.text);
      // 检查关键词是否在题目中
      if (normQ.includes(kw)) {
        const score = ngramSimilarity(query, normQ, 2);
        const existing = candidates.get(q.id);
        if (!existing || score > existing.score) {
          candidates.set(q.id, { question: q, score, keyword: kw });
        }
      }
    }
  }

  // 找出最高分的候选
  let best = null;
  let bestScore = 0;
  for (const [id, data] of candidates) {
    if (data.score > bestScore) {
      bestScore = data.score;
      best = data;
    }
  }

  // 相似度阈值：> 0.35 认为有足够匹配
  const THRESHOLD = 0.35;
  if (best && bestScore >= THRESHOLD) {
    console.log(`[Search] 模糊匹配成功: score=${bestScore.toFixed(3)}, kw="${best.keyword}"`);
    return {
      question: best.question,
      matchType: 'fuzzy',
      confidence: bestScore,
    };
  }

  console.log(`[Search] 未匹配 (keywords: ${keywords.join(', ')}, bestScore: ${bestScore.toFixed(3)})`);
  return { question: null, matchType: 'none', confidence: 0 };
}

/**
 * 清除内存索引（用于清空题库后重建）。
 */
export function invalidate() {
  normalizedIndex = null;
  allQuestions = null;
  indexBuilt = false;
}

/**
 * 获取当前索引状态。
 */
export function getStats() {
  return {
    indexed: indexBuilt,
    count: allQuestions?.length ?? 0,
    uniqueKeys: normalizedIndex?.size ?? 0,
  };
}

export default { search, buildIndex, invalidate, getStats };
