# 搜题工具 — 项目文档

## 项目概述
基于 Cloudflare 平台的移动端 Web 实时 AI 识题工具。
用户打开网页 → 允许摄像头 → 将题目放入识别框 → 系统自动识别并显示答案。

## 目录结构
```
souti/
├── index.html              # 主页面
├── manifest.json           # PWA 配置
├── package.json
├── server.mjs              # 本地开发服务器（:8788）
├── wrangler.json           # Cloudflare Worker 配置
├── css/main.css            # 全部样式
├── js/app.js               # 前端入口
├── vendor/xlsx.full.min.js # SheetJS（Excel 解析，已下载到本地）
├── icons/                  # PWA 图标
├── src/
│   ├── config.js           # 所有可调参数（抽帧间隔、稳定时间、超时等）
│   ├── state/              # 有限状态机（15 种状态 + 合法转移表）
│   │   ├── machine.js      # 状态定义和转移规则
│   │   └── store.js        # 响应式状态管理 + subscribe API
│   ├── camera/index.js     # 摄像头管理（getUserMedia，后置优先）
│   ├── detection/index.js  # 画面检测（变化检测、稳定判断、hash）
│   ├── processing/index.js # 图片处理（截取、缩放、压缩）
│   ├── provider/index.js   # AI Provider 层（统一接口，不硬编码模型名）
│   ├── import/
│   │   ├── models.js       # 题目数据模型（单选/多选/判断/简述）
│   │   ├── parser.js       # Excel/CSV 解析器
│   │   └── index.js        # 导入管理（串联 parser + storage）
│   ├── db/storage.js       # IndexedDB 题库存储
│   ├── api/routes.js       # Worker API 路由
│   ├── ui/
│   │   ├── index.js        # 主 UI（状态渲染、结果面板、识别框绘制）
│   │   └── import-panel.js # 题库导入面板
│   └── app.js              # 主控制器（串联所有模块）
└── worker/index.js         # Cloudflare Worker（AI 代理）
```

## 已知问题 & 限制

### 当前阶段
- **Phase 1-4 代码已完成**，但 AI 识别需要配置 Cloudflare Workers AI 凭据才能实际运行
- 题库导入使用 IndexedDB 本地存储，刷新页面后保留
- 本地开发服务器 (:8788) 不提供 /api/solve 真实代理（需 wrangler dev 配合）

### 下一步必需配置
1. 运行 `wrangler login` 登录 Cloudflare
2. 配置 Secrets：
   ```bash
   wrangler secret put WORKERS_AI_ACCOUNT_ID
   wrangler secret put WORKERS_AI_API_KEY
   ```
3. 在 Cloudflare Dashboard 启用 Workers AI 模型
4. 部署：`wrangler deploy`

### 浏览器兼容性
- iOS Safari 14+：需确保 `playsinline` 和 HTTPS 环境
- Android Chrome 90+：正常支持
- 桌面浏览器：可使用前置摄像头预览

## 测试方式

### 本地预览
```bash
npm run dev
# 访问 http://localhost:8788
# 调试模式: http://localhost:8788?debug=1
```

### 导入题库测试
1. 点击右上角 📚 按钮
2. 拖入或选择 `题库示例.xlsx`
3. 查看统计面板：单选561、多选258、判断254，共1073题

### 完整测试（需 Worker 配置）
```bash
npm run worker:dev
# 同时在另一个终端
npm run dev
# 两个服务都运行后，AI 识别链路完整可用
```
