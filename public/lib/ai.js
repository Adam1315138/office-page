/**
 * AI 调用层：DeepSeek / 任意 OpenAI 兼容接口 + 内置搜索
 *
 * 搜索走本地服务的 /api/search（服务端抓取，不受浏览器跨域限制），
 * 所以用户只需要一个模型 API key，搜索零配置。
 */

(function () {
  'use strict';

  function normalizeBase(url) {
    let u = String(url || '').trim();
    if (!u) return 'https://api.deepseek.com/v1';
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/, '');
    return u;
  }

  /** 解析 SSE 流 */
  function createSSEParser(onEvent) {
    let buf = '';
    return {
      push(chunk) {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let data = [];
          for (const line of block.split('\n')) {
            const t = line.trim();
            if (t.startsWith('data:')) data.push(t.slice(5).trim());
          }
          if (data.length) onEvent(data.join('\n'));
        }
      },
      flush() {
        if (buf.trim()) {
          for (const line of buf.split('\n')) {
            const t = line.trim();
            if (t.startsWith('data:')) onEvent(t.slice(5).trim());
          }
          buf = '';
        }
      }
    };
  }

  /**
   * 发起对话。
   * @param {object} p
   * @param {object} p.settings { baseUrl, model, apiKey }
   * @param {Array}  p.messages
   * @param {Function} [p.onDelta]
   * @param {AbortSignal} [p.signal]
   */
  async function chat({ settings, messages, onDelta, signal }) {
    const base = normalizeBase(settings.baseUrl);
    const targetUrl = base + '/chat/completions';
    const model = String(settings.model || 'deepseek-v4-flash').trim();

    // 走本地转发：某些模型 API 不返回 CORS 头，浏览器直连会被拦。
    // 勾上"请求经本地转发"后，请求绕一下本地服务端，就不需要自建外部 CORS 代理。
    let url = targetUrl;
    if (settings.useProxy) {
      const proxyBase = String(settings.searchBase || 'http://localhost:3000').replace(/\/+$/, '');
      url = proxyBase + '/api/proxy?url=' + encodeURIComponent(targetUrl);
    }

    const body = {
      model,
      messages,
      stream: true,
      temperature: 0.3
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (settings.apiKey || '')
      },
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        if (j.error && j.error.message) detail = j.error.message;
      } catch (e) { /* ignore */ }

      const hints = {
        401: 'API Key 不对或已失效',
        402: '账户余额不足',
        403: '没有该模型的权限',
        404: '模型名或地址不对（模型名现在应该是 deepseek-v4-flash）',
        429: '请求太频繁，被限流了'
      };
      const hint = hints[res.status] ? hints[res.status] + '：' : '';
      throw new Error(hint + detail + '（HTTP ' + res.status + '）');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let usage = null;

    const parser = createSSEParser((data) => {
      if (!data || data === '[DONE]') return;
      let json;
      try { json = JSON.parse(data); } catch (e) { return; }
      if (json.usage) usage = json.usage;
      const choice = json.choices && json.choices[0];
      if (!choice) return;
      const delta = choice.delta || {};
      if (delta.content) {
        content += delta.content;
        if (onDelta) onDelta(delta.content);
      }
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();

    return { content, usage };
  }

  /**
   * 调本地服务的搜索接口
   * @param {string} query
   * @param {string} searchBase  本地服务地址
   * @param {object} [opts] { provider, key } —— 想用商业 API 时传，不传就是免费内置
   */
  /* ------------------------------------------------------------------ */
  /* 浏览器直连检索（页面托管在公网、本地服务不可用时走这条）             */
  /* ------------------------------------------------------------------ */

  /**
   * 只有自己支持 CORS 的搜索 API 才能浏览器直连。实测：
   *   Tavily  access-control-allow-origin: *
   *   Serper  access-control-allow-origin: *
   *   Exa     CORS 头完整
   *   Brave   405，不支持 → 不在列表里
   * 360 / 必应这种抓网页的完全不行，必须靠服务端。
   */
  const DIRECT = {
    tavily: async (query, key, limit) => {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          query,
          max_results: Math.min(limit, 20),
          search_depth: 'basic',
          include_answer: false
        }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
      });
      if (!res.ok) throw new Error('Tavily HTTP ' + res.status);
      const d = await res.json();
      return (d.results || []).map((r) => ({ title: r.title || '', url: r.url || '', snippet: r.content || '' }));
    },

    serper: async (query, key, limit) => {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q: query, num: Math.min(limit, 10) }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
      });
      if (!res.ok) throw new Error('Serper HTTP ' + res.status);
      const d = await res.json();
      return (d.organic || []).map((r) => ({ title: r.title || '', url: r.link || '', snippet: r.snippet || '' }));
    },

    exa: async (query, key, limit) => {
      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query, numResults: Math.min(limit, 10), contents: { text: { maxCharacters: 1000 } } }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
      });
      if (!res.ok) throw new Error('Exa HTTP ' + res.status);
      const d = await res.json();
      return (d.results || []).map((r) => ({ title: r.title || '', url: r.url || '', snippet: r.text || '' }));
    }
  };

  async function directSearch(query, provider, key, limit) {
    const errors = [];
    const tried = [];

    const order = [];
    const want = String(provider || 'auto').toLowerCase();
    if (want !== 'auto' && DIRECT[want] && key) order.push(want);
    // 兜底：用户可能只填了 key 但没切 provider，或首选源挂了
    for (const name of Object.keys(DIRECT)) {
      if (!order.includes(name) && key && want === 'auto') order.push(name);
    }

    if (order.length === 0) {
      return {
        results: [],
        provider: 'none',
        tried,
        errors: ['本地服务不可用，且没有可直连的搜索 Key（请到设置里填 Tavily / Serper / Exa 的 Key）']
      };
    }

    for (const name of order) {
      tried.push(name);
      try {
        const results = await DIRECT[name](query, key, limit);
        if (results && results.length) return { results, provider: name + '（直连）', tried, errors };
        errors.push(name + '：没有返回结果');
      } catch (err) {
        errors.push(name + '：' + (err && err.message ? err.message : String(err)));
      }
    }
    return { results: [], provider: 'none', tried, errors };
  }

  /** 本地地址判断 */
  function isLoopback(base) {
    try {
      const u = new URL(base);
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    } catch (e) {
      return false;
    }
  }

  /**
   * 托管在公网（https）时，浏览器会直接拒绝访问 http://localhost
   * （Private Network Access 策略），连试都不必试，否则控制台一片红。
   */
  function canReach(base) {
    if (!base) return false;
    const hosted = location.protocol === 'https:';
    if (hosted && isLoopback(base)) return false;
    return true;
  }

  /**
   * 检索入口：先问本地服务（它能用免费源），服务不可用就浏览器直连。
   * 页面托管在 GitHub Pages / Cloudflare Pages 时，本地服务本来就不存在，直接走直连。
   */
  async function search(query, searchBase, opts) {
    const o = opts || {};
    const limit = Math.max(1, Math.min(20, Number(o.limit) || 8));
    const errors = [];

    // 1. 本地服务
    const base = String(searchBase || '').replace(/\/+$/, '');
    if (canReach(base)) {
      const headers = {};
      if (o.provider && o.provider !== 'auto') headers['X-Search-Provider'] = o.provider;
      if (o.key) headers['X-Search-Key'] = o.key;
      try {
        const res = await fetch(base + '/api/search?q=' + encodeURIComponent(query), {
          headers,
          signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
        });
        if (res.ok) {
          const out = await res.json();
          if (out && out.results && out.results.length) return out;
          if (out && out.errors) errors.push(...out.errors);
        } else {
          errors.push('本地服务 HTTP ' + res.status);
        }
      } catch (err) {
        // 托管在公网时这一步必然失败（没有本地服务），静默转直连
        errors.push('本地服务不可用');
      }
    }

    // 2. 浏览器直连
    const direct = await directSearch(query, o.provider, o.key, limit);
    direct.errors = errors.concat(direct.errors);
    return direct;
  }

  /** 拉取服务端支持的搜索源列表（服务没起时返回 null，界面用内置兜底） */
  async function listProviders(searchBase) {
    const base = String(searchBase || 'http://localhost:3000').replace(/\/+$/, '');
    if (!canReach(base)) return null; // 公网托管时不去戳 localhost
    try {
      const res = await fetch(base + '/api/search-providers', {
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.providers) ? data.providers : null;
    } catch (e) {
      return null;
    }
  }

  /** 探测各搜索源连通性（服务端并发发最小请求）；公网托管时没有服务端，直接告知 */
  async function checkProviders(searchBase) {
    const base = String(searchBase || 'http://localhost:3000').replace(/\/+$/, '');
    if (!canReach(base)) {
      throw new Error('当前是公网托管版本，没有本地服务可探测。搜索会由浏览器直连 Tavily / Serper / Exa，连通性取决于你填的 Key。');
    }
    const res = await fetch(base + '/api/check-providers', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined
    });
    if (!res.ok) throw new Error('探测接口返回 HTTP ' + res.status);
    const data = await res.json();
    return data.results || [];
  }

  /** 把搜索结果拼成给模型看的文本 */
  function formatSearchResults(results) {
    if (!results || results.length === 0) return '（没有检索到结果）';
    return results.map((r, i) => {
      const lines = ['[' + (i + 1) + '] ' + (r.title || '(无标题)')];
      lines.push('URL: ' + (r.url || ''));
      if (r.snippet) lines.push('摘要: ' + r.snippet);
      return lines.join('\n');
    }).join('\n\n');
  }

  window.AI = { chat, search, listProviders, formatSearchResults, normalizeBase };
})();
