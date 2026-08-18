/**
 * API 路由模块 — Worker 中代理导入和管理接口
 *
 * 路径：
 *   POST   /api/import      — 导入题库文件
 *   GET    /api/questions   — 获取题目列表
 *   GET    /api/stats       — 获取统计信息
 *   DELETE /api/clear       — 清空题库
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── POST /api/import ──────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/api/import') {
      return await handleImport(request, env, corsHeaders, ctx);
    }

    // ── GET /api/stats ────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/api/stats') {
      return jsonResponse({
        total: 0,
        singleChoice: 0,
        multipleChoice: 0,
        trueFalse: 0,
        shortAnswer: 0,
        note: 'IndexedDB 题库在客户端本地，服务端无状态统计',
      }, 200, corsHeaders);
    }

    // ── 静态资源回退 ──────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};

async function handleImport(request, env, corsHeaders, ctx) {
  // 第一阶段：Worker 端不存储题库（题库在客户端 IndexedDB）
  // 此接口仅用于记录导入事件，或未来接入 D1 时使用
  return jsonResponse(
    { success: false, message: '题库导入在浏览器本地完成，请使用前端 API' },
    501,
    corsHeaders,
  );
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
