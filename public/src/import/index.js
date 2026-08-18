/**
 * 导入管理模块 — 串联 parser + storage，提供统一 API
 *
 * 供 UI 层调用。
 */

import { parseAndValidate } from './parser.js';
import Storage from '../db/storage.js';

/**
 * 导入题库文件。
 * @param {File} file
 * @returns {Promise<{success: boolean, stats: {added, duplicates, total}, errors: Array}>}
 */
export async function importFile(file) {
  try {
    const { questions, errors } = await parseAndValidate(file);

    if (questions.length === 0) {
      return {
        success: false,
        stats: { added: 0, duplicates: 0, total: 0 },
        errors: errors.length > 0 ? errors : [{ row: 1, error: '未解析出任何题目，请检查列名是否正确' }],
      };
    }

    const { added, duplicates } = await Storage.importQuestions(questions);
    const total = await Storage.getQuestionCount();

    return {
      success: true,
      stats: { added, duplicates, total },
      errors,
    };
  } catch (err) {
    return {
      success: false,
      stats: { added: 0, duplicates: 0, total: 0 },
      errors: [{ row: 0, error: err.message }],
    };
  }
}

/**
 * 获取题库统计信息。
 */
export async function getStats() {
  const all = await Storage.getAllQuestions();
  const byType = {
    single_choice: all.filter(q => q.type === 'single_choice').length,
    multiple_choice: all.filter(q => q.type === 'multiple_choice').length,
    true_false: all.filter(q => q.type === 'true_false').length,
    short_answer: all.filter(q => q.type === 'short_answer').length,
  };
  return {
    total: all.length,
    ...byType,
  };
}

/**
 * 清空题库。
 */
export async function clearQuestions() {
  await Storage.clearAllQuestions();
}

export default {
  importFile,
  getStats,
  clearQuestions,
};
