#!/usr/bin/env node
/**
 * 本地开发服务器 — 静态文件服务 + Worker 代理
 *
 * 使用方式：npm run dev
 * 访问：http://localhost:8788
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8788;
const ROOT = join(__dirname, '.');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.manifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  // 代理 /api/* 请求到本地 Worker（需要手动配置）
  if (req.url?.startsWith('/api/')) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Worker 未运行，请使用 wrangler dev' }));
    return;
  }

  let filePath = join(ROOT, req.url === '/' ? 'index.html' : req.url);

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const stats = statSync(filePath);
  if (stats.isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  ✅ 本地开发服务器已启动`);
  console.log(`  📱 访问地址: http://localhost:${PORT}`);
  console.log(`  🔍 调试模式: http://localhost:${PORT}?debug=1`);
  console.log(`  ⚡ Worker:   npm run worker:dev\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  ❌ 端口 ${PORT} 已被占用，请关闭相关进程后重试`);
  } else {
    console.error('  ❌ 服务器错误:', err.message);
  }
  process.exit(1);
});
