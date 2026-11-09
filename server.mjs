/**
 * Office Copilot 本地服务
 *
 * 一个进程干三件事：
 *   1. 托管加载项静态页面（public/）
 *   2. /api/search            —— 服务端抓取/调用搜索 API，返回 JSON
 *   3. /api/search-providers  —— 告诉界面有哪些搜索源可选
 *
 * 为什么搜索放服务端：Office 加载项是普通网页，直接请求搜索站会被 CORS 拦；
 * 服务端没这个限制，所以默认零配置就能搜。
 *
 * 搜索 provider 的可插拔逻辑全在 search.mjs，想接新 API 改那里。
 *
 * 启动：node server.mjs    （或双击 start.bat）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { searchWeb, listProviders, checkProviders } from './search.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  // 界面通过这两个头把搜索源和 key 传给本地服务
  'Access-Control-Allow-Headers': 'content-type,authorization,x-search-provider,x-search-key'
};

/* ------------------------------------------------------------------ */
/* 通用转发（当 CORS 代理用）                                           */
/* ------------------------------------------------------------------ */

/**
 * 允许经本地服务转发的目标域名。
 * 只放行这几个，避免这个端口被当成任意翻墙代理。
 * 想加自己的模型服务，往数组里加域名即可。
 */
const PROXY_ALLOWED_HOSTS = [
  'api.deepseek.com',
  'api.openai.com',
  'api.anthropic.com',
  'open.bigmodel.cn',
  'dashscope.aliyuncs.com',
  'api.moonshot.cn',
  'ark.cn-beijing.volces.com'
];

/** 逐块转发响应（支持 SSE 流式），并处理压缩与长度头 */
async function pipeUpstream(res, upstream) {
  const headers = {};
  for (const [k, v] of upstream.headers) {
    const key = k.toLowerCase();
    // 这几个头不能原样透传：fetch 已解压、长度会变
    if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) continue;
    headers[k] = v;
  }
  Object.assign(headers, CORS_HEADERS);

  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }, CORS_HEADERS));
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/taskpane.html' : pathname;
  const filePath = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(PUBLIC) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + rel);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  /* ---- 搜索源列表 ---- */
  if (pathname === '/api/search-providers') {
    sendJson(res, 200, { providers: listProviders() });
    return;
  }

  /* ---- 连通性探测（对应界面上的"测试连通性"按钮）---- */
  if (pathname === '/api/check-providers') {
    try {
      const results = await checkProviders();
      console.log('[check] 连通性探测完成：'
        + results.map((r) => r.id + (r.reachable ? '✓' : '✗')).join(' '));
      sendJson(res, 200, { results });
    } catch (err) {
      sendJson(res, 500, { results: [], error: String((err && err.message) || err) });
    }
    return;
  }

  /* ---- 通用转发（当 CORS 代理用）----
   * 用途：某些模型 API 不返回 CORS 头，浏览器直连会被拦。
   * 让请求绕一下本地服务端，就不需要再自建 Cloudflare Worker。
   */
  if (pathname === '/api/proxy') {
    const target = url.searchParams.get('url');
    if (!target) {
      sendJson(res, 400, { error: '缺少 ?url= 参数' });
      return;
    }

    let t;
    try {
      t = new URL(target);
    } catch (e) {
      sendJson(res, 400, { error: '目标地址不合法' });
      return;
    }

    if (!/^https?:$/.test(t.protocol) || !PROXY_ALLOWED_HOSTS.includes(t.hostname)) {
      sendJson(res, 403, {
        error: '目标域名不在白名单：' + t.hostname,
        hint: '要在 server.mjs 的 PROXY_ALLOWED_HOSTS 里加上它'
      });
      return;
    }

    const fwd = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (['host', 'origin', 'referer', 'connection', 'content-length'].includes(key)) continue;
      fwd[k] = v;
    }

    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }

    try {
      const upstream = await fetch(t.toString(), { method: req.method, headers: fwd, body, redirect: 'follow' });
      await pipeUpstream(res, upstream);
    } catch (err) {
      sendJson(res, 502, { error: '转发失败：' + String((err && err.message) || err) });
    }
    return;
  }

  /* ---- 搜索 ---- */
  if (pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const provider = req.headers['x-search-provider'] || url.searchParams.get('provider') || 'auto';
    const key = req.headers['x-search-key'] || url.searchParams.get('key') || '';
    const limit = url.searchParams.get('limit') || 8;

    const t0 = Date.now();
    try {
      const out = await searchWeb(q, { provider, key, limit });
      console.log('[search] "' + q.slice(0, 30) + '" → ' + out.results.length + ' 条'
        + ' | 试过: ' + out.tried.join('→')
        + ' | ' + (Date.now() - t0) + 'ms'
        + (out.errors.length ? '\n         降级原因: ' + out.errors.join(' ; ') : ''));
      sendJson(res, 200, out);
    } catch (err) {
      sendJson(res, 500, { results: [], provider: 'none', errors: [String((err && err.message) || err)] });
    }
    return;
  }

  /* ---- 健康检查 ---- */
  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      providers: listProviders().map((p) => p.id)
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.on('error', (err) => {
  // 开机自启动时会和手动启动撞端口，这种情况静默退出即可，不要弹窗报错
  if (err && err.code === 'EADDRINUSE') {
    console.log('端口 ' + PORT + ' 已被占用——服务应该已经在跑了，本次启动跳过。');
    process.exit(0);
  }
  console.error('启动失败：', err && err.message ? err.message : err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Office Copilot 已启动');
  console.log('  加载项地址: http://localhost:' + PORT + '/taskpane.html');
  console.log('  搜索接口:   http://localhost:' + PORT + '/api/search?q=测试');
  console.log('  可用搜索源: ' + listProviders().map((p) => p.id + (p.needsKey ? '(需key)' : '')).join(', '));
  console.log('');
  console.log('  使用期间请保持这个窗口不要关。按 Ctrl+C 停止。');
  console.log('');
});
