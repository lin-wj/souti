/**
 * Cloudflare Worker — 代理 AI 请求
 *
 * 架构：
 *   前端 → Worker (/api/solve) → Workers AI → 返回结构化结果
 *
 * 敏感凭据通过 Wrangler Secrets 注入，不写死在代码中。
 * 需要设置的 Secret：
 *   WORKERS_AI_ACCOUNT_ID  — Cloudflare Account ID
 *   WORKERS_AI_API_KEY     — API Key（或在 Worker 中使用 Cloudflare Authorization）
 */

const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8';
const VISION_PROMPT = `你是一位经验丰富的老师，擅长识别题目并给出答案和解析。

请仔细观察题目图片，完成以下任务：
1. 提取题目内容
2. 判断科目和题型
3. 给出答案
4. 提供详细解析

请以 JSON 格式返回，不要包含其他文字：
{
  "success": true,
  "question": "题目内容（原文）",
  "subject": "科目（math/chinese/english/science/other）",
  "question_type": "题型（multiple_choice/fill_blank/short_answer/calculation/essay/other）",
  "answer": "答案",
  "explanation": "详细解析",
  "confidence": 0.95
}

如果无法识别题目（图片模糊、无题目内容、题目不完整等），请返回：
{
  "success": false,
  "error": "错误原因",
  "error_code": "no_question|blurry|incomplete|too_small|ai_failed"
}`;

export default {
  async fetch(request, env, ctx) {
    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── /api/solve ──────────────────────────────────────
    if (request.method === 'POST' && request.url.endsWith('/api/solve')) {
      return await handleSolve(request, env, corsHeaders, ctx);
    }

    // ── 静态资源 ────────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};

/**
 * 处理识题请求
 */
async function handleSolve(request, env, corsHeaders, ctx) {
  try {
    const body = await request.json();
    const { image } = body;

    if (!image || typeof image !== 'string') {
      return jsonResponse(
        { success: false, error: '缺少图片数据', error_code: 'invalid_image' },
        400,
        corsHeaders,
      );
    }

    // 检查 base64 前缀
    let base64Data = image;
    if (image.includes(',')) {
      base64Data = image.split(',')[1];
    }

    // 调用 Workers AI
    const visionResponse = await callVisionModel(base64Data, env, ctx);
    const parsed = parseVisionResponse(visionResponse);

    return jsonResponse(parsed, 200, corsHeaders);
  } catch (err) {
    console.error('[Worker] Solve error:', err);
    return jsonResponse(
      { success: false, error: err.message, error_code: 'ai_failed' },
      500,
      corsHeaders,
    );
  }
}

/**
 * 调用 Workers AI 视觉模型
 */
async function callVisionModel(base64Data, env, ctx) {
  const accountId = env.WORKERS_AI_ACCOUNT_ID;
  if (!accountId) {
    throw new Error('WORKERS_AI_ACCOUNT_ID not configured');
  }

  const modelUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${AI_MODEL}`;

  const resp = await fetch(modelUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.WORKERS_AI_API_KEY || ''}`,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: VISION_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别这张图片中的题目并给出答案和解析。' },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Data}` },
            },
          ],
        },
      ],
      stream: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Workers AI error ${resp.status}: ${text}`);
  }

  return await resp.json();
}

/**
 * 解析 Workers AI 返回，提取 JSON
 */
function parseVisionResponse(aiResponse) {
  const result = aiResponse.result;
  const message = result?.message;
  const content = message?.content;

  if (typeof content === 'string') {
    try {
      // 尝试从文本中提取 JSON（有些模型会在 JSON 前后加解释文字）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch {
      // 解析失败，返回原始文本作为 fallback
      return {
        success: false,
        error: 'AI 返回格式异常',
        error_code: 'ai_failed',
        raw: content,
      };
    }
  }

  return {
    success: false,
    error: 'AI 返回格式异常',
    error_code: 'ai_failed',
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  });
}
