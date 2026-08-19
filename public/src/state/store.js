/**
 * 状态管理器 — 基于有限状态机的响应式状态
 *
 * 职责：
 *   1. 维护当前状态
 *   2. 执行合法转移
 *   3. 通知 UI 更新
 *   4. 提供调试信息
 */
import { State, canTransition, stateLabel } from './machine.js';

let currentState = State.INITIALIZING;
let listeners = [];
let debugInfo = {};

export function getState() {
  return currentState;
}

/** 尝试转移到新状态，仅当转移合法时才执行。 */
export function setState(nextState, info = {}) {
  if (!canTransition(currentState, nextState)) {
    console.warn(`[State] Invalid transition: ${currentState} → ${nextState}`);
    return false;
  }
  const prev = currentState;
  currentState = nextState;
  const timestamp = Date.now();
  const source = info.source || 'unknown';
  const errName = info.error?.name || '';
  const errMsg = info.error?.message || '';
  console.log(
    `[STATE] ${prev} → ${nextState}`,
    `source=${source}`,
    errName ? `error=${errName}: ${errMsg}` : ''
  );
  if (nextState === State.CAMERA_ERROR) {
    console.trace(`[STATE] CAMERA_ERROR set by: ${source}`);
  }
  debugInfo = {
    prev,
    current: nextState,
    label: stateLabel(nextState),
    timestamp,
    source,
    error: info.error,
    ...info,
  };
  notifyListeners();
  return true;
}

export function getCurrentState() {
  return currentState;
}

/** 注册状态变更监听器，返回取消函数。 */
export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn({ state: currentState, debug: { ...debugInfo } });
    } catch (e) {
      console.error('[State] Listener error:', e);
    }
  }
}

export function getDebugInfo() {
  return { ...debugInfo };
}

/** 重置到初始状态，用于重新初始化摄像头。 */
export function reset() {
  currentState = State.INITIALIZING;
  debugInfo = {};
  notifyListeners();
}

export default {
  getState,
  setState,
  getCurrentState,
  subscribe,
  getDebugInfo,
  reset,
};
