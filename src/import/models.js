/**
 * 题目数据模型
 *
 * 支持的题型：
 *   - single_choice   单选题（答案为 A/B/C/D）
 *   - multiple_choice 多选题（答案为 ABC/ABCD 等）
 *   - true_false      判断题（答案为 正确/错误）
 *   - short_answer    简答题（无选项，答案自由文本）
 */

export const QuestionType = Object.freeze({
  SINGLE_CHOICE: 'single_choice',
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  SHORT_ANSWER: 'short_answer',
});

/**
 * 从 Excel/CSV 行数据推断题型。
 * @param {string} answer — 答案单元格内容
 * @param {boolean} hasOptions — 是否有至少2个选项
 * @returns {QuestionType}
 */
export function inferType(answer, hasOptions) {
  const ans = String(answer || '').trim();

  // 判断题
  if (ans === '正确' || ans === '错误') {
    return QuestionType.TRUE_FALSE;
  }

  // 纯字母组合（A/B/C/D/AB/ABC/ABCD 等）
  if (/^[A-G]+$/.test(ans)) {
    return hasOptions ? QuestionType.MULTIPLE_CHOICE : QuestionType.SHORT_ANSWER;
  }

  // 其他文本答案（可能是简答题）
  if (!hasOptions) {
    return QuestionType.SHORT_ANSWER;
  }

  // 有选项但答案不是字母 → 可能判断题的特殊格式或简答题
  return QuestionType.SHORT_ANSWER;
}

/**
 * 将题目对象转换为 AI 可识别的格式化题目文本。
 * 用于将题库题目展示给用户，或与其他识别结果对比。
 */
export function formatQuestionText(q) {
  const { text, options, answer, type } = q;

  if (type === QuestionType.TRUE_FALSE) {
    return `【判断题】${text}\n答案：${answer}`;
  }

  if (type === QuestionType.SHORT_ANSWER) {
    return `【简答题】${text}\n答案：${answer}`;
  }

  // 选择题
  const optionText = options
    .filter(o => o.text)
    .map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`)
    .join('\n');

  return `【${type === QuestionType.SINGLE_CHOICE ? '单选' : '多选'}题】${text}\n${optionText}\n答案：${answer}`;
}

/**
 * 从 Excel/CSV 的一行数据构造题目对象。
 * @param {object} row — 行数据 { 题干, 答案, 选项A, 选项B, ... }
 * @returns {Question | null}
 */
export function rowToQuestion(row) {
  const text = String(row['题干'] || '').trim();
  const answer = String(row['答案'] || '').trim();

  if (!text || !answer) return null;

  const options = [];
  const optionKeys = ['选项A', '选项B', '选项C', '选项D', '选项E', '选项F'];
  for (const key of optionKeys) {
    const val = row[key];
    if (val !== null && val !== undefined && String(val).trim()) {
      options.push({
        key: String.fromCharCode(65 + options.length),
        text: String(val).trim(),
      });
    }
  }

  const hasOptions = options.length >= 2;
  const type = inferType(answer, hasOptions);

  return {
    id: null, // 由数据库分配
    text,
    answer,
    type,
    options,
    rawRow: row,
    importedAt: Date.now(),
  };
}

export default { QuestionType, inferType, formatQuestionText, rowToQuestion };
