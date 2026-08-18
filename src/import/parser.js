/**
 * 文件导入模块 — 支持 Excel (.xlsx/.xlsm) 和 CSV 导入
 *
 * 职责：
 *   - 解析上传的文件
 *   - 按固定列名提取题目数据
 *   - 类型推断与清洗
 *   - 去重检查
 *   - 写入存储
 */

import * as XLSX from '/vendor/xlsx.full.min.js';
import { rowToQuestion } from './models.js';

// ── 列名映射（兼容不同命名习惯）──────────────────────────
const COLUMN_MAP = {
  '题干': '题干',
  '题目': '题干',
  '问题': '题干',
  '答案': '答案',
  '正确选项': '答案',
  '选答': '答案',
  '选项A': '选项A',
  'A': '选项A',
  '选项B': '选项B',
  'B': '选项B',
  '选项C': '选项C',
  'C': '选项C',
  '选项D': '选项D',
  'D': '选项D',
  '选项E': '选项E',
  'E': '选项E',
  '选项F': '选项F',
  'F': '选项F',
};

/**
 * 读取 Excel/CSV 文件的原始行数据。
 * @param {File} file
 * @returns {Promise<Array<{header: string[], rows: any[]}]>}
 */
export async function parseFile(file) {
  const ext = file.name.toLowerCase();

  if (ext.endsWith('.csv')) {
    return await parseCSV(file);
  }

  if (ext.endsWith('.xlsx') || ext.endsWith('.xlsm')) {
    return await parseExcel(file);
  }

  throw new Error('不支持的文件格式，请上传 .xlsx 或 .csv 文件');
}

/**
 * 解析 CSV 文件。
 */
async function parseCSV(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) {
    throw new Error('CSV 文件为空或只有一行');
  }

  // 简单 CSV 解析（不处理引号内逗号，因为题库格式简单）
  const parseLine = (line) =>
    line.split(',').map(cell => cell.trim().replace(/^["']|["']$/g, ''));

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });

  return { headers, rows };
}

/**
 * 解析 Excel 文件（使用 SheetJS/xlsx 库）。
 */
export async function parseExcel(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (data.length < 2) {
    throw new Error('Excel 文件为空或只有一行');
  }

  const rawHeaders = data[0];
  // 清理列名（去除空白）
  const headers = rawHeaders.map(h => String(h).trim());

  const rows = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });

  return { headers, rows };
}

/**
 * 规范化列名，返回统一列名的行数据。
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function normalizeColumns(rows) {
  return rows.map(row => {
    const normalized = {};
    for (const [rawKey, standardKey] of Object.entries(COLUMN_MAP)) {
      if (row[rawKey] !== undefined) {
        normalized[standardKey] = row[rawKey];
      }
    }
    return normalized;
  }).filter(row => row['题干'] !== undefined); // 过滤掉没有题干的行
}

/**
 * 解析并验证导入数据。
 * @param {File} file
 * @returns {Promise<{questions: Question[], errors: Array<{row: number, error: string}>}>}
 */
export async function parseAndValidate(file) {
  const { rows } = await parseFile(file);
  const normalized = normalizeColumns(rows);

  const questions = [];
  const errors = [];

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    try {
      const q = rowToQuestion(row);
      if (q) {
        questions.push(q);
      } else {
        errors.push({ row: i + 2, error: '题干或答案为空，已跳过' });
      }
    } catch (err) {
      errors.push({ row: i + 2, error: err.message });
    }
  }

  return { questions, errors };
}

export default { parseFile, parseAndValidate, normalizeColumns };
