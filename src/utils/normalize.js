/**
 * 题目文本标准化模块
 *
 * 将 OCR 识别文本和题库题干统一到同一格式，便于精确匹配。
 *
 * 处理规则（按优先级）：
 *   1. 去除首尾空白
 *   2. 全角 → 半角（括号、标点、字母、数字）
 *   3. 合并连续空白/换行为单个空格
 *   4. 移除无意义标点（书名号、括号外的句号等）
 *   5. 保留填空占位符 (    ) / （  ） 的语义结构
 *   6. 英文统一小写
 *   7. 常见 OCR 字符混淆纠正
 *
 * 不处理：
 *   - 数字（避免误改）
 *   - 数学公式符号
 *   - 选项编号 A/B/C/D
 */

/**
 * 全角转半角。
 */
function fullWidthToHalfWidth(text) {
  return text.replace(/[！-～]/g, c => {
    const code = c.charCodeAt(0);
    if (code === 0x3000) return ' '; // 全角空格 → 半角空格
    return String.fromCharCode(code - 0xfee0);
  });
}

/**
 * OCR 常见字符混淆纠正表。
 * 键为 OCR 可能产生的错误字符，值为正确字符。
 * 注意：不处理数字，避免误改。
 */
const OCR_FIXES = {
  // 字母混淆
  'Ｏ': 'O', 'ｏ': 'o',
  'Ｉ': '1', 'ｉ': '1', // I/i 易与 1 混淆
  'ｌ': '1', '｜': '1', // l/| 易与 1 混淆
  '０': '0', '１': '1', '２': '2', '３': '3',
  '４': '4', '５': '5', '６': '6', '７': '7',
  '８': '8', '９': '9',
  // 标点混淆
  '，': ',', '。': '.', '！': '!', '？': '?',
  '：': ':', '；': ';',
  '％': '%', '￥': 'Y',
  // 括号规范化
  '（': '(', '）': ')',
};

/**
 * 标准化文本。
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  if (!text) return '';

  let result = String(text).trim();

  // 1. 全角→半角
  result = fullWidthToHalfWidth(result);

  // 2. OCR 字符混淆纠正
  for (const [wrong, correct] of Object.entries(OCR_FIXES)) {
    result = result.split(wrong).join(correct);
  }

  // 3. 统一英文小写（在标点后，避免把答案字母 A/B/C/D 也变小写）
  // 只对中文和英文混合的部分处理，选项字母保持原样
  // 策略：将连续的英文单词转为小写，但单独的 A-Z 选项字母不变
  result = result.replace(/[a-z]+/g, match => {
    // 如果是单个大写字母且在括号内或作为选项出现，保持大写
    if (match.length === 1 && /^[A-G]$/.test(match)) return match;
    return match.toLowerCase();
  });

  // 4. 合并连续空白（包括换行、制表符等）
  result = result.replace(/[\s ]+/g, ' ');

  // 5. 去除无关标点（保留括号、顿号、逗号、句号用于语义）
  // 移除：书名号、引号、斜杠、竖线、冒号后的空格
  result = result
    .replace(/[「」『』〔〕【】]/g, '')          // 中文书名号/方括号
    .replace(/["""''''']/g, '')                  // 各种引号
    .replace(/\s*\/\s*/g, '/')                   // 斜杠前后空格
    .replace(/\s*\|\s*/g, '|')                   // 竖线前后空格
    .replace(/：\s*/g, ':');                     // 冒号后空格

  // 6. 填空占位符规范化：保留 ( ) 和 （ ）但去掉内部多余空格
  result = result.replace(/\(\s*\)/g, '( )').replace(/（\s*）/g, '（ ）');

  return result;
}

/**
 * 提取文本中的核心关键词（用于模糊匹配的候选生成）。
 * 使用中文连续字符序列（≥3个字符）+ 英文单词。
 */
export function extractKeywords(text, minLen = 3) {
  const keywords = [];
  // 中文关键词：连续汉字/数字/字母 ≥ minLen
  const cnPattern = /[一-鿿a-zA-Z0-9]{${minLen},}/g;
  let match;
  while ((match = cnPattern.exec(text)) !== null) {
    keywords.push(normalize(match[0]));
  }
  return [...new Set(keywords)];
}

/**
 * 计算两个标准化文本的字符级编辑距离（简化版，用于相似度评估）。
 * 仅用于小规模候选排序，不做完整 DP。
 */
export function charOverlap(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));
  let overlap = 0;
  for (const c of setA) {
    if (setB.has(c)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size, 1);
}

/**
 * n-gram 相似度（用于候选排序）。
 */
export function ngramSimilarity(a, b, n = 2) {
  if (!a || !b) return 0;
  const gramsA = new Set();
  for (let i = 0; i <= a.length - n; i++) gramsA.add(a.substring(i, i + n));
  const gramsB = new Set();
  for (let i = 0; i <= b.length - n; i++) gramsB.add(b.substring(i, i + n));
  let overlap = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) overlap++;
  }
  const total = Math.max(gramsA.size, gramsB.size, 1);
  return overlap / total;
}

export default { normalize, extractKeywords, charOverlap, ngramSimilarity };
