/**
 * 前端状态机
 *
 * 状态定义：
 *   INITIALIZING    — 启动摄像头
 *   CAMERA_READY    — 摄像头就绪，等待题目
 *   SEARCHING       — 正在搜索题目（首次进入识别框）
 *   DETECTING       — 检测到画面有变化
 *   STABILIZING     — 画面持续稳定中
 *   CAPTURING       — 截取最佳帧（极短）
 *   PROCESSING      — AI 识别/解题中
 *   SHOWING_RESULT  — 显示答案
 *   WAITING_FOR_CHANGE — 锁定当前题目，等待画面变化
 *
 * 异常状态：
 *   CAMERA_ERROR, NETWORK_ERROR, AI_ERROR, INVALID_IMAGE, NO_QUESTION
 */
export const State = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  CAMERA_READY: 'CAMERA_READY',
  SEARCHING: 'SEARCHING',
  DETECTING: 'DETECTING',
  STABILIZING: 'STABILIZING',
  CAPTURING: 'CAPTURING',
  PROCESSING: 'PROCESSING',
  SHOWING_RESULT: 'SHOWING_RESULT',
  WAITING_FOR_CHANGE: 'WAITING_FOR_CHANGE',
  CAMERA_ERROR: 'CAMERA_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AI_ERROR: 'AI_ERROR',
  INVALID_IMAGE: 'INVALID_IMAGE',
  NO_QUESTION: 'NO_QUESTION',
});

/** 合法的状态转移，用于防御性校验。 */
export const TRANSITIONS = Object.freeze({
  [State.INITIALIZING]: [State.CAMERA_READY, State.CAMERA_ERROR],
  [State.CAMERA_READY]: [State.SEARCHING, State.CAMERA_ERROR],
  [State.SEARCHING]: [State.DETECTING, State.CAPTURED_NO_CONTENT, State.CAMERA_ERROR],
  [State.DETECTING]: [State.STABILIZING, State.SEARCHING, State.CAMERA_ERROR],
  [State.STABILIZING]: [State.CAPTURING, State.DETECTING, State.CAMERA_ERROR],
  [State.CAPTURING]: [State.PROCESSING],
  [State.PROCESSING]: [
    State.SHOWING_RESULT,
    State.AI_ERROR,
    State.INVALID_IMAGE,
    State.NO_QUESTION,
    State.NETWORK_ERROR,
  ],
  [State.SHOWING_RESULT]: [State.WAITING_FOR_CHANGE],
  [State.WAITING_FOR_CHANGE]: [State.DETECTING, State.CAMERA_ERROR],
  [State.CAMERA_ERROR]: [State.INITIALIZING],
  [State.AI_ERROR]: [State.WAITING_FOR_CHANGE, State.CAMERA_READY],
  [State.INVALID_IMAGE]: [State.WAITING_FOR_CHANGE],
  [State.NO_QUESTION]: [State.WAITING_FOR_CHANGE],
  [State.NETWORK_ERROR]: [State.WAITING_FOR_CHANGE],
});

// 补充 SEARCHING 可能直接进入的情况
TRANSITIONS[State.SEARCHING].push('CAPTURED_NO_CONTENT');

/** 判断状态转移是否合法。 */
export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/** 获取一个"正在处理"的语义标签，供 UI 展示。 */
export function stateLabel(state) {
  const labels = {
    [State.INITIALIZING]: '启动摄像头…',
    [State.CAMERA_READY]: '将题目放入识别框',
    [State.SEARCHING]: '搜索题目中…',
    [State.DETECTING]: '检测到变化',
    [State.STABILIZING]: '保持稳定…',
    [State.CAPTURING]: '截取画面',
    [State.PROCESSING]: 'AI 识别中…',
    [State.SHOWING_RESULT]: '识别完成',
    [State.WAITING_FOR_CHANGE]: '题目已识别，移动至下一题',
    [State.CAMERA_ERROR]: '摄像头错误',
    [State.NETWORK_ERROR]: '网络异常',
    [State.AI_ERROR]: 'AI 识别失败',
    [State.INVALID_IMAGE]: '图片质量不足',
    [State.NO_QUESTION]: '未检测到题目',
  };
  return labels[state] ?? state;
}

export default State;
