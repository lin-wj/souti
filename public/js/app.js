import app from '../src/app.js';
import ImportPanel from '../src/ui/import-panel.js';
import Storage from '../src/db/storage.js';

// 初始化导入面板
ImportPanel.init();

// 调试按钮
const debugBtn = document.getElementById('debug-trigger');
if (debugBtn) {
  debugBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      params.delete('debug');
    } else {
      params.set('debug', '1');
    }
    window.location.search = params.toString();
  });
}

// 题库状态持久化通知（页面加载时刷新统计）
window.addEventListener('load', async () => {
  try {
    const count = await Storage.getQuestionCount();
    if (count > 0) {
      console.log(`[App] 本地题库已加载: ${count} 道题`);
    }
  } catch {}
});

app.init().catch(console.error);
