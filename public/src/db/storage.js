/**
 * 题目存储模块
 *
 * 架构：
 *   - 开发环境：IndexedDB（浏览器本地持久化）
 *   - 生产环境（未来）：D1 或 KV
 *
 * 第一阶段仅实现 IndexedDB 版本，满足"不上传完整视频流"的隐私要求，
 * 同时保证用户刷新页面后题库仍然存在。
 */

const DB_NAME = 'souti-db';
const DB_VERSION = 1;
const STORE_NAME = 'questions';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('importedAt', 'importedAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(new Error('IndexedDB 打开失败'));
  });
}

/**
 * 批量导入题目。
 * @param {Array<object>} questions — 题目数组（来自 parser）
 * @returns {Promise<{added: number, duplicates: number}>}
 */
export async function importQuestions(questions) {
  const database = await openDB();
  const tx = database.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  let added = 0;
  let duplicates = 0;

  // 先去重：检查题干是否已存在
  const allQuestions = await getAllQuestions();
  const existingTexts = new Set(allQuestions.map(q => q.text.trim().toLowerCase()));

  for (const q of questions) {
    const key = q.text.trim().toLowerCase();
    if (existingTexts.has(key)) {
      duplicates++;
      continue;
    }
    store.add(q);
    existingTexts.add(key);
    added++;
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve({ added, duplicates });
    tx.onerror = () => reject(new Error('导入失败'));
  });
}

/**
 * 获取所有题目。
 */
export async function getAllQuestions() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('查询失败'));
  });
}

/**
 * 按题型筛选题目。
 */
export async function getQuestionsByType(type) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('type');
    const request = index.getAll(type);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('查询失败'));
  });
}

/**
 * 清空所有题目。
 */
export async function clearAllQuestions() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('清空失败'));
  });
}

/**
 * 获取题目总数。
 */
export async function getQuestionCount() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('查询失败'));
  });
}

export default {
  importQuestions,
  getAllQuestions,
  getQuestionsByType,
  clearAllQuestions,
  getQuestionCount,
};
