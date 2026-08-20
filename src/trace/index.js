/**
 * Trace 诊断模块 — 页面内日志面板
 *
 * 使用方式：
 *   ?debug=trace
 *
 * 功能：
 *   - 实时日志面板（底部，可滚动）
 *   - 流程计数器（Detection/Capture/OCR/Search/Result）
 *   - 时间戳 + 标签格式
 *   - 复制日志 / 清空日志 / 关闭按钮
 */

let _enabled = false;
let _logs = [];
let _counts = { detection: 0, capture: 0, ocr: 0, search: 0, result: 0, error: 0 };
let _panel = null;
let _logEl = null;
let _timer = null;

const CONFIG = {
  CHANGE_THRESHOLD: 0.06,
  STABLE_DURATION: 800,
  FRAME_INTERVAL: 500,
  COOLDOWN_TIME: 2000,
};

/**
 * 获取当前时间字符串。
 */
function time() {
  const d = new Date();
  return d.toTimeString().slice(0, 12);
}

/**
 * 主 trace 函数。
 * @param {string} tag — 模块标签，如 'SCAN', 'CAPTURE', 'OCR', 'SEARCH', 'UI'
 * @param {...*} args — 日志内容
 */
export function trace(tag, ...args) {
  const msg = `[${time()}] [${tag}] ${args.map(a => {
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ')}`;

  _logs.push(msg);
  console.log(msg);

  if (_logEl) {
    _logEl.textContent = msg + '\n' + _logEl.textContent;
    // 限制日志条数，防止内存溢出
    if (_logs.length > 2000) {
      _logs = _logs.slice(-1500);
      _logEl.textContent = _logs.slice().reverse().join('\n');
    }
  }
}

/**
 * 增加计数器。
 */
export function inc(key) {
  if (_counts[key] !== undefined) _counts[key]++;
}

/**
 * 检查是否启用 trace 模式。
 */
export function isEnabled() {
  return _enabled;
}

/**
 * 初始化 trace 面板。
 */
export function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== 'trace') return;

  _enabled = true;
  trace('TRACE', '诊断模式已启动');
  trace('TRACE', 'Config: CHANGE_THRESHOLD=' + CONFIG.CHANGE_THRESHOLD +
        ' STABLE_DURATION=' + CONFIG.STABLE_DURATION +
        ' FRAME_INTERVAL=' + CONFIG.FRAME_INTERVAL +
        ' COOLDOWN_TIME=' + CONFIG.COOLDOWN_TIME);

  createPanel();
  startStatsTimer();
}

/**
 * 创建诊断面板 DOM。
 */
function createPanel() {
  // 创建面板
  _panel = document.createElement('div');
  _panel.id = 'trace-panel';
  _panel.innerHTML = `
    <div class="trace-header">
      <span class="trace-title">🔬 扫描流程诊断 (?debug=trace)</span>
      <div class="trace-counters">
        <span id="trace-c-detection">Detection: 0</span>
        <span id="trace-c-capture">Capture: 0</span>
        <span id="trace-c-ocr">OCR: 0</span>
        <span id="trace-c-search">Search: 0</span>
        <span id="trace-c-result">Result: 0</span>
        <span id="trace-c-error" style="color:#f87171">Error: 0</span>
      </div>
      <div class="trace-actions">
        <button id="trace-copy">📋 复制</button>
        <button id="trace-clear">🗑️ 清空</button>
        <button id="trace-close">✕ 关闭</button>
      </div>
    </div>
    <div id="trace-log"></div>
  `;

  document.body.appendChild(_panel);

  _logEl = document.getElementById('trace-log');

  // 按钮事件
  document.getElementById('trace-copy').addEventListener('click', () => {
    const text = _logs.slice().reverse().join('\n');
    navigator.clipboard.writeText(text).then(
      () => trace('TRACE', '日志已复制到剪贴板'),
      () => trace('TRACE', '复制失败，请手动选择文本')
    );
  });

  document.getElementById('trace-clear').addEventListener('click', () => {
    _logs = [];
    _logEl.textContent = '';
    trace('TRACE', '日志已清空');
  });

  document.getElementById('trace-close').addEventListener('click', () => {
    _panel.style.display = 'none';
  });
}

/**
 * 每秒更新计数器显示。
 */
function startStatsTimer() {
  _timer = setInterval(() => {
    document.getElementById('trace-c-detection').textContent = 'Detection: ' + _counts.detection;
    document.getElementById('trace-c-capture').textContent = 'Capture: ' + _counts.capture;
    document.getElementById('trace-c-ocr').textContent = 'OCR: ' + _counts.ocr;
    document.getElementById('trace-c-search').textContent = 'Search: ' + _counts.search;
    document.getElementById('trace-c-result').textContent = 'Result: ' + _counts.result;
    document.getElementById('trace-c-error').textContent = 'Error: ' + _counts.error;
  }, 500);
}

/**
 * 清理资源。
 */
export function destroy() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_panel) { _panel.remove(); _panel = null; }
  _enabled = false;
}

// 导出所有工具函数
export const incDetection = () => { _counts.detection++; trace('SCAN', 'detection loop tick'); };
export const incCapture = () => { _counts.capture++; };
export const incOcr = () => { _counts.ocr++; };
export const incSearch = () => { _counts.search++; };
export const incResult = () => { _counts.result++; };
export const incError = () => { _counts.error++; trace('ERROR', ...arguments); };

export default { init, destroy, trace, inc };
