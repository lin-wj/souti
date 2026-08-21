/**
 * Trace 诊断模块 — 页面内日志面板
 *
 * 使用方式：
 *   ?debug=trace
 *
 * 功能：
 *   - 实时状态面板（顶部，显示当前检测状态）
 *   - 日志流（底部，可滚动，事件驱动）
 *   - 流程计数器（Detection Ticks/Capture/OCR/Search/Result/Error）
 *   - 时间戳 + 标签格式
 *   - 复制日志 / 清空日志 / 关闭按钮
 */

let _enabled = false;
let _logs = [];
let _counts = { detection: 0, capture: 0, ocr: 0, search: 0, result: 0, error: 0 };
let _panel = null;
let _logEl = null;
let _stateEl = null;
let _timer = null;

// 当前扫描状态快照（由 app.js 每秒更新）
let _scanState = {
  content: '-',
  change: '-',
  stable: '0/0',
  ready: '-',
  reason: '-',
  similarity: '-',
  cooldown: '-',
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
    if (_logs.length > 3000) {
      _logs = _logs.slice(-2000);
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
 * 更新扫描状态快照（供实时面板显示）。
 */
export function showState(state) {
  // state: { content, change, stable, changeFromRecognized, questionChanged, questionChangedCount, ready, reason, similarity, cooldown }
  _scanState = { ..._scanState, ...state };
  if (_stateEl) {
    _stateEl.textContent = formatState(_scanState);
  }
}

function formatState(s) {
  const parts = [];
  parts.push('Content: ' + (s.content ? 'YES' : 'NO'));
  parts.push('Stable: ' + s.stable);
  parts.push('Change: ' + (typeof s.change === 'number' ? (s.change * 100).toFixed(1) + '%' : s.change));
  if (s.changeFromRecognized !== undefined && s.changeFromRecognized !== '-') {
    parts.push('ChgRec: ' + (typeof s.changeFromRecognized === 'number' ? (s.changeFromRecognized * 100).toFixed(1) + '%' : s.changeFromRecognized));
  }
  if (s.questionChanged !== undefined) {
    parts.push('QChanged: ' + (s.questionChanged ? 'YES' : 'NO'));
  }
  if (s.questionChangedCount !== undefined) {
    parts.push('QCount: ' + s.questionChangedCount);
  }
  parts.push('Ready: ' + (s.ready ? 'YES' : 'NO' + (s.reason ? ' (' + s.reason + ')' : '')));
  if (s.similarity !== '-' && s.similarity !== undefined) parts.push('Sim: ' + s.similarity);
  if (s.cooldown !== '-' && s.cooldown > 0) parts.push('CD: ' + Math.ceil(s.cooldown) + 'ms');
  return parts.join('  ');
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
export function init(config) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== 'trace') return;

  _enabled = true;
  trace('TRACE', '诊断模式已启动');
  trace('TRACE', 'Config: CHANGE_THRESHOLD=' + (config?.CHANGE_THRESHOLD ?? '?') +
        ' STABLE_FRAME_COUNT=' + (config?.STABLE_FRAME_COUNT ?? '?') +
        ' FRAME_INTERVAL=' + (config?.FRAME_INTERVAL ?? '?') +
        ' COOLDOWN_TIME=' + (config?.COOLDOWN_TIME ?? '?'));

  createPanel();
  startStatsTimer();
}

/**
 * 创建诊断面板 DOM。
 */
function createPanel() {
  _panel = document.createElement('div');
  _panel.id = 'trace-panel';
  _panel.innerHTML = `
    <div class="trace-header">
      <span class="trace-title">🔬 扫描流程诊断 (?debug=trace)</span>
      <div id="trace-state" class="trace-state">Content: -  Stable: 0/0  Ready: NO</div>
      <div class="trace-counters">
        <span id="trace-c-detection">Detection Ticks: 0</span>
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
  _stateEl = document.getElementById('trace-state');

  document.getElementById('trace-copy').addEventListener('click', () => {
    const text = _logs.slice().reverse().join('\n');
    navigator.clipboard.writeText(text).then(
      () => trace('TRACE', '日志已复制到剪贴板'),
      () => trace('TRACE', '复制失败，请手动选择文本')
    );
  });

  document.getElementById('trace-clear').addEventListener('click', () => {
    _logs = [];
    _logEl.textContent = '\n';
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
    document.getElementById('trace-c-detection').textContent = 'Detection Ticks: ' + _counts.detection;
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

export default { init, destroy, trace, inc, showState };
