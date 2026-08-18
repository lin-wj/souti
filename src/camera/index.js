/**
 * Camera 模块 — 管理摄像头流
 *
 * 职责：
 *   - 打开/关闭摄像头
 *   - 优先使用后置摄像头
 *   - 兼容 iOS Safari / Android Chrome
 *   - 提供实时视频流给 Canvas
 */

const DEFAULT_constraints = {
  video: {
    facingMode: 'environment', // 后置摄像头
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

let stream = null;
let videoEl = null;
let onErrorCallbacks = [];
let onStreamCallbacks = [];

/** 注册摄像头错误回调。 */
export function onCameraError(fn) {
  onErrorCallbacks.push(fn);
  return () => {
    onErrorCallbacks = onErrorCallbacks.filter((f) => f !== fn);
  };
}

/** 注册摄像头就绪回调。 */
export function onStreamReady(fn) {
  onStreamCallbacks.push(fn);
  return () => {
    onStreamCallbacks = onStreamCallbacks.filter((f) => f !== fn);
  };
}

/**
 * 打开摄像头，返回 Promise。
 * 失败时会抛出 Error，并通过 onErrorCallbacks 通知。
 */
export async function startCamera() {
  if (stream) {
    stopCamera();
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia(DEFAULT_constraints);
  } catch (err) {
    const message = classifyCameraError(err);
    onErrorCallbacks.forEach((fn) => fn(err, message));
    throw err;
  }

  // 等待视频元素就绪
  videoEl = document.createElement('video');
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.autoplay = true;
  videoEl.srcObject = stream;

  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play().then(resolve).catch(reject);
    };
    videoEl.onerror = () => reject(new Error('Video element error'));
  });

  onStreamCallbacks.forEach((fn) => fn(stream, videoEl));
  return { stream, videoEl };
}

/** 停止摄像头并释放资源。 */
export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
    videoEl = null;
  }
}

/** 获取当前摄像头分辨率。 */
export function getVideoDimensions() {
  if (!videoEl || !videoEl.videoWidth) return null;
  return { width: videoEl.videoWidth, height: videoEl.videoHeight };
}

/**
 * 根据错误对象返回用户友好的错误信息。
 */
function classifyCameraError(err) {
  const code = err.name || err.code;
  switch (code) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return '请允许浏览器访问摄像头';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '未检测到摄像头设备';
    case 'NotReadableError':
    case 'TrackStartError':
      return '摄像头被其他应用占用';
    default:
      return `摄像头错误: ${err.message || code}`;
  }
}

export default {
  startCamera,
  stopCamera,
  getVideoDimensions,
  onCameraError,
  onStreamReady,
  get stream() {
    return stream;
  },
  get videoEl() {
    return videoEl;
  },
};
