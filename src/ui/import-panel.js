/**
 * 导入面板 UI — 题库上传与管理
 *
 * 功能：
 *   - 拖拽/点击上传 .xlsx 或 .csv
 *   - 显示解析进度和结果
 *   - 显示统计信息（题目总数、各题型数量）
 *   - 一键清空题库
 */

import ImportManager from '../import/index.js';
import Storage from '../db/storage.js';

/**
 * 初始化导入面板（动态注入到 body）。
 */
export function init() {
  const panel = document.createElement('div');
  panel.id = 'import-panel';
  panel.innerHTML = `
    <div class="import-panel-header">
      <span class="import-title">📚 题库管理</span>
      <button class="import-close" id="import-close-btn" title="关闭">✕</button>
    </div>
    <div class="import-drop-zone" id="import-drop-zone">
      <div class="drop-icon">📁</div>
      <div class="drop-text">点击或拖拽上传题库</div>
      <div class="drop-hint">支持 .xlsx / .csv，列名：题干、答案、选项A-F</div>
      <input type="file" id="import-file-input" accept=".xlsx,.xlsm,.csv" style="display:none">
    </div>
    <div class="import-progress" id="import-progress" style="display:none">
      <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-text" id="progress-text">解析中…</div>
    </div>
    <div class="import-result" id="import-result" style="display:none"></div>
    <div class="import-stats" id="import-stats" style="display:none">
      <div class="stats-grid">
        <div class="stat-item"><span class="stat-num" id="stat-total">0</span><span class="stat-label">总题数</span></div>
        <div class="stat-item"><span class="stat-num" id="stat-single">0</span><span class="stat-label">单选</span></div>
        <div class="stat-item"><span class="stat-num" id="stat-multi">0</span><span class="stat-label">多选</span></div>
        <div class="stat-item"><span class="stat-num" id="stat-tf">0</span><span class="stat-label">判断</span></div>
      </div>
      <button class="btn-clear" id="clear-btn">清空题库</button>
    </div>
  `;

  document.body.appendChild(panel);

  // 拖拽上传
  const dropZone = panel.querySelector('#import-drop-zone');
  const fileInput = panel.querySelector('#import-file-input');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // 关闭按钮
  panel.querySelector('#import-close-btn').addEventListener('click', () => {
    panel.classList.toggle('open');
  });

  // 清空按钮
  panel.querySelector('#clear-btn').addEventListener('click', handleClear);

  refreshStats();
}

async function handleFile(file) {
  showProgress('正在解析文件…', 20);

  try {
    const result = await ImportManager.importFile(file);
    hideProgress();

    if (result.success) {
      showSuccess(result.stats, result.errors);
      refreshStats();
    } else {
      showError(result.errors.map(e => e.error).join('\n'));
    }
  } catch (err) {
    hideProgress();
    showError(err.message);
  }

  fileInput.value = '';
}

function showProgress(text, percent) {
  const el = document.getElementById('import-progress');
  if (!el) return;
  el.style.display = 'block';
  const textEl = document.getElementById('progress-text');
  const fillEl = document.getElementById('progress-fill');
  if (textEl) textEl.textContent = text;
  if (fillEl) fillEl.style.width = `${percent}%`;
}

function hideProgress() {
  const el = document.getElementById('import-progress');
  if (el) el.style.display = 'none';
}

function showSuccess(stats, errors) {
  const el = document.getElementById('import-result');
  if (!el) return;
  el.innerHTML = `
    <div class="result-success">
      <div class="success-icon">✅</div>
      <div class="success-text">
        成功导入 <strong>${stats.added}</strong> 道题
        ${stats.duplicates > 0 ? `（跳过 ${stats.duplicates} 道重复）` : ''}
      </div>
      ${errors.length > 0 ? `<div class="result-warnings">${errors.length} 行数据跳过</div>` : ''}
    </div>
  `;
  el.style.display = 'block';
}

function showError(message) {
  const el = document.getElementById('import-result');
  if (!el) return;
  el.innerHTML = `<div class="result-error">❌ ${message}</div>`;
  el.style.display = 'block';
}

async function refreshStats() {
  try {
    const stats = await ImportManager.getStats();
    const el = document.getElementById('import-stats');
    if (!el) return;

    const totalEl = document.getElementById('stat-total');
    const singleEl = document.getElementById('stat-single');
    const multiEl = document.getElementById('stat-multi');
    const tfEl = document.getElementById('stat-tf');

    if (totalEl) totalEl.textContent = stats.total;
    if (singleEl) singleEl.textContent = stats.single_choice;
    if (multiEl) multiEl.textContent = stats.multiple_choice;
    if (tfEl) tfEl.textContent = stats.true_false;

    el.style.display = stats.total > 0 ? 'block' : 'none';
  } catch {
    // 忽略
  }
}

async function handleClear() {
  if (!confirm('确定要清空所有题库吗？此操作不可撤销。')) return;
  await Storage.clearAllQuestions();
  refreshStats();
  const el = document.getElementById('import-stats');
  if (el) el.style.display = 'none';
}

export default { init };
