/**
 * 搜索层（可插拔 provider 架构）
 *
 * 设计目标：现在零配置能用，未来想接商业 API 只需在界面填个 key，不用改代码。
 *
 * 三层：
 *   1. 内置免费：bing / duckduckgo（服务端抓页面，不需要 key）
 *   2. 商业 API：tavily / serper / brave / exa（需要 key，由前端传 header 过来）
 *   3. 自定义口子：customProvider —— 想接自己的搜索服务，只改这一个函数
 *
 * provider 选择优先级：
 *   请求里指定的 provider（且有 key）→ 免费内置兜底
 */

/* ------------------------------------------------------------------ */
/* 通用工具                                                             */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓页面。
 * 注意 withUa：实测伪造浏览器 UA 反而会让 Bing 判定为爬虫（返回验证页、b_algo=0），
 * 用 Node 默认 UA 才能拿到正常结果。所以默认不伪装。
 */
async function fetchHtml(url, { withUa = false, timeoutMs = 10000 } = {}) {
  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };
  if (withUa) headers['User-Agent'] = BROWSER_UA;

  const res = await fetchWithTimeout(url, { headers }, timeoutMs);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/* ------------------------------------------------------------------ */
/* 页面解析（内置免费 provider 用）                                      */
/* ------------------------------------------------------------------ */

function parseBing(html) {
  const out = [];
  const blocks = String(html).split(/<li class="b_algo"/).slice(1);
  for (const block of blocks) {
    const m = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    let url = decodeEntities(m[1]);
    if (url.includes('bing.com/ck/a')) {
      const b64 = url.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
      if (b64) {
        try {
          const pad = b64[1].replace(/-/g, '+').replace(/_/g, '/');
          url = Buffer.from(pad, 'base64').toString('binary');
        } catch (e) { /* 保持原样 */ }
      }
    }
    if (!/^https?:\/\//.test(url)) continue;

    // 过滤 Bing 自己的导航块（"必应图像""搜索图片"这类会混进 b_algo）
    if (/^https?:\/\/([a-z0-9-]+\.)*bing\.com\//i.test(url)) continue;

    const title = stripTags(m[2]);
    const sm = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = sm ? stripTags(sm[1]) : '';

    // 标题太短、或没有摘要且标题像导航的，多半不是正文结果
    if (title.length < 4) continue;
    if (!snippet && /^(必应|搜索|图片|视频|地图|资讯|更多)/.test(title)) continue;

    out.push({ title, url, snippet });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 解析 Bing 的 RSS 输出（format=rss）。
 * 比抓 HTML 干净得多：标准 XML、链接是真实地址、没有导航块和广告。
 */
function parseBingRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => {
      const mm = m[1].match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
      if (!mm) return '';
      return decodeEntities(mm[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim();
    };
    const title = pick('title');
    const url = pick('link');
    if (!title || !/^https?:\/\//.test(url)) continue;
    out.push({ title, url, snippet: pick('description') });
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * 解析 360 搜索结果页。
 * 实测这是当前网络下唯一稳定可用的免费源（5-6 条真结果、全部命中查询）。
 */
function parseSo360(html) {
  const out = [];
  const s = String(html);
  for (const block of s.split(/<li class="res-list/).slice(1)) {
    const h = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!h) continue;
    const a = h[1].match(/href="([^"]+)"/);
    const title = stripTags(h[1]);
    if (!a || !title) continue;

    let url = decodeEntities(a[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    else if (url.startsWith('/')) url = 'https://www.so.com' + url;
    if (!/^https?:\/\//.test(url)) continue;

    const p = block.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title, url, snippet: p ? stripTags(p[1]) : '' });
    if (out.length >= 8) break;
  }
  return out;
}

function parseDdgLite(html) {
  const out = [];
  const re = /<a[^>]*class=['"]result-link['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = decodeEntities(m[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch (e) { /* 保持 */ }
    }
    if (!/^https?:\/\//.test(url)) continue;
    out.push({ title: stripTags(m[2]), url, snippet: '' });
    if (out.length >= 8) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Provider 注册表                                                      */
/* ------------------------------------------------------------------ */

/**
 * 每个 provider:
 *   id        标识
 *   label     界面显示名
 *   needsKey  是否需要 API Key
 *   keyHint   key 从哪申请（界面提示用）
 *   run(query, key, limit) => Promise<[{title,url,snippet}]>
 */
const PROVIDERS = {
  so360: {
    id: 'so360',
    label: '360 搜索（免费，默认）',
    needsKey: false,
    async run(query, key, limit) {
      // 8 秒足够，超时就让后面的源接上，别让用户干等
      const html = await fetchHtml('https://www.so.com/s?q=' + encodeURIComponent(query), { timeoutMs: 8000 });
      return parseSo360(html).slice(0, limit);
    }
  },

  bingrss: {
    id: 'bingrss',
    label: '必应 RSS（免费）',
    needsKey: false,
    async run(query, key, limit) {
      // format=rss 拿到的是标准 XML，不受页面改版影响，也不会混进导航块
      const xml = await fetchHtml(
        'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query),
        { timeoutMs: 9000 }
      );
      return parseBingRss(xml).slice(0, limit);
    }
  },

  bing: {
    id: 'bing',
    label: '必应（免费，抓页面）',
    needsKey: false,
    async run(query, key, limit) {
      const url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN&form=QBLH';
      // 先用默认 UA（实测最稳），拿不到结果再试浏览器 UA
      let results = parseBing(await fetchHtml(url));
      if (results.length === 0) {
        results = parseBing(await fetchHtml(url, { withUa: true }));
      }
      return results.slice(0, limit);
    }
  },

  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo（免费，抓页面）',
    needsKey: false,
    async run(query, key, limit) {
      const html = await fetchHtml('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), { timeoutMs: 8000 });
      return parseDdgLite(html).slice(0, limit);
    }
  },

  /* ---- 国内首选 ---- */
  bocha: {
    id: 'bocha',
    label: '博查 Bocha（国内直连，需 Key）',
    needsKey: true,
    keyHint: 'https://open.bochaai.com 注册申请，国内延迟低、最稳',
    async run(query, key, limit) {
      const res = await fetchWithTimeout('https://api.bochaai.com/v1/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          query,
          summary: true,
          freshness: 'noLimit',
          count: Math.min(limit, 20)
        })
      });
      if (!res.ok) {
        throw new Error('博查 HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      }
      const data = await res.json();
      const items = (data.data && data.data.webPages && data.data.webPages.value) || [];
      return items.map((x) => ({
        title: x.name || '',
        url: x.url || '',
        // 博查的 summary 比 snippet 完整，优先用
        snippet: x.summary || x.snippet || ''
      }));
    }
  },

  /* ---- 国际通用 ---- */
  tavily: {
    id: 'tavily',
    label: 'Tavily（需 Key）',
    needsKey: true,
    keyHint: 'https://tavily.com 申请，形如 tvly-xxx',
    async run(query, key, limit) {
      const res = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          query,
          max_results: Math.min(limit, 20),
          search_depth: 'basic',
          include_answer: false
        })
      });
      if (!res.ok) throw new Error('Tavily HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      const data = await res.json();
      return (data.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || ''
      }));
    }
  },

  serper: {
    id: 'serper',
    label: 'Serper（需 Key，Google 结果）',
    needsKey: true,
    keyHint: 'https://serper.dev 申请，免费 2500 次',
    async run(query, key, limit) {
      const res = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q: query, num: Math.min(limit, 10) })
      });
      if (!res.ok) throw new Error('Serper HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      const data = await res.json();
      return (data.organic || []).map((r) => ({
        title: r.title || '',
        url: r.link || '',
        snippet: r.snippet || ''
      }));
    }
  },

  brave: {
    id: 'brave',
    label: 'Brave（需 Key）',
    needsKey: true,
    keyHint: 'https://brave.com/search/api 申请',
    async run(query, key, limit) {
      const res = await fetchWithTimeout(
        'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + Math.min(limit, 20),
        { headers: { Accept: 'application/json', 'X-Subscription-Token': key } }
      );
      if (!res.ok) throw new Error('Brave HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      const data = await res.json();
      return ((data.web && data.web.results) || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || ''
      }));
    }
  },

  exa: {
    id: 'exa',
    label: 'Exa（需 Key，可读全文）',
    needsKey: true,
    keyHint: 'https://exa.ai 申请',
    async run(query, key, limit) {
      const res = await fetchWithTimeout('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query, numResults: Math.min(limit, 20), contents: { text: { maxCharacters: 1200 } } })
      });
      if (!res.ok) throw new Error('Exa HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      const data = await res.json();
      return (data.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.text || r.summary || ''
      }));
    }
  },

  firecrawl: {
    id: 'firecrawl',
    label: 'Firecrawl（爬虫式，需 Key）',
    needsKey: true,
    keyHint: 'https://firecrawl.dev 申请',
    async run(query, key, limit) {
      const res = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ query, limit: Math.min(limit, 10) })
      });
      if (!res.ok) throw new Error('Firecrawl HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      const data = await res.json();
      return (data.data || []).map((x) => ({
        title: x.title || '',
        url: x.url || '',
        snippet: x.description || (x.markdown ? String(x.markdown).slice(0, 400) : '')
      }));
    }
  },

  serpapi: {
    id: 'serpapi',
    label: 'SerpAPI（Google 结果，需 Key）',
    needsKey: true,
    keyHint: 'https://serpapi.com 申请',
    async run(query, key, limit) {
      const url = 'https://serpapi.com/search.json?q=' + encodeURIComponent(query)
        + '&num=' + Math.min(limit, 10)
        + '&api_key=' + encodeURIComponent(key);
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('SerpAPI HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
      const data = await res.json();
      return (data.organic_results || []).map((x) => ({
        title: x.title || '',
        url: x.link || '',
        snippet: x.snippet || ''
      }));
    }
  },

  /* ================================================================
   * ↓↓↓ 想接自己的搜索 API？改这一个函数就行 ↓↓↓
   *
   * 约定：返回 [{ title, url, snippet }]，其余交给上层处理。
   * 在界面里选「自定义」并填入 key，就会走到这里。
   * ================================================================ */
  custom: {
    id: 'custom',
    label: '自定义（改 server.mjs 的 customProvider）',
    needsKey: true,
    keyHint: '填你自己的 key，请求逻辑在 server.mjs 的 custom provider 里',
    async run(query, key, limit) {
      // 示例（取消注释并改成你的接口）：
      //
      // const res = await fetchWithTimeout('https://your-search-api.com/search', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      //   body: JSON.stringify({ q: query, limit })
      // });
      // if (!res.ok) throw new Error('自定义搜索 HTTP ' + res.status);
      // const data = await res.json();
      // return (data.items || []).map((x) => ({
      //   title: x.title,
      //   url: x.link,
      //   snippet: x.desc || ''
      // }));

      throw new Error('自定义搜索还没实现，请在 server.mjs 的 custom provider 里写好请求逻辑');
    }
  }
};

/** 免费兜底链（不需要 key，永远排在最后）
 *  顺序来自实测：360 稳定出结果；必应 RSS 偶尔被限流；抓 HTML 最容易拿到缓存页；
 *  DuckDuckGo 在当前网络下完全不通，留作最后一步。 */
const FREE_FALLBACK = ['so360', 'bingrss', 'bing', 'duckduckgo'];

/**
 * 相关性门禁：抓页面拿到的结果经常是缓存页、导航块或完全无关的内容。
 * 这里检查结果里有多少条真的命中了查询词，低于阈值就判定为无效。
 *
 * 不加这道门禁的后果很严重：模型会拿着"必应图像""ChatGPT"这类内容硬答。
 */
function isRelevant(results, query) {
  if (!results || results.length === 0) return false;

  const q = String(query || '').toLowerCase();
  // 英文按词、中文按 2-gram
  const terms = new Set();
  for (const w of q.matchAll(/[a-z][a-z0-9_+-]{1,}/g)) terms.add(w[0]);
  for (const seg of q.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const s = seg[0];
    for (let i = 0; i + 2 <= s.length; i += 1) terms.add(s.slice(i, i + 2));
  }
  if (terms.size === 0) return true; // 查询里没有可判定的词，放过

  let hit = 0;
  for (const r of results) {
    const text = ((r.title || '') + ' ' + (r.snippet || '')).toLowerCase();
    let matched = false;
    for (const term of terms) {
      if (text.includes(term)) { matched = true; break; }
    }
    if (matched) hit += 1;
  }

  // 至少要有 2 条命中（结果不足 2 条则要求全部命中）
  return hit >= Math.min(2, results.length);
}

/**
 * 免费源并发竞速：同时向所有免费源发请求，第一个拿到「有效结果」的就赢。
 *
 * 为什么不是串行降级：实测这些站点随手一个 8-15 秒超时，串行四次就是用户干等一分钟。
 * 并发后总耗时 ≈ 最快的那个源，个别源被风控也不影响整体。
 */
async function raceFreeProviders(query, limit, errors, tried) {
  const names = FREE_FALLBACK.filter((n) => PROVIDERS[n]);
  const tasks = names.map(async (name) => {
    tried.push(name);
    const p = PROVIDERS[name];
    try {
      const results = await p.run(query, '', limit);
      if (!results || results.length === 0) {
        errors.push(p.label + '：没有返回结果');
        return null;
      }
      if (!isRelevant(results, query)) {
        errors.push(p.label + '：结果与查询无关（缓存页/风控页），已丢弃');
        return null;
      }
      return { results, provider: name };
    } catch (err) {
      errors.push(p.label + '：' + (err && err.message ? err.message : String(err)));
      return null;
    }
  });

  // 用"先成功先返回"的方式，避免被最慢的源拖住；
  // 再加一道 10 秒硬上限——个别站点 TLS 握手会挂死，不能让它拖住整个请求。
  return new Promise((resolve) => {
    let pending = tasks.length;
    let settled = false;

    const done = (hit) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(hit);
    };

    const deadline = setTimeout(() => {
      errors.push('总耗时超过 10 秒，已放弃等待剩余的源');
      done(null);
    }, 10000);

    for (const t of tasks) {
      t.then((hit) => {
        pending -= 1;
        if (hit) done(hit);
        else if (pending === 0) done(null);
      }).catch(() => {
        pending -= 1;
        if (pending === 0) done(null);
      });
    }
    if (pending === 0) done(null);
  });
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {string} query
 * @param {object} opts
 * @param {string} [opts.provider]  指定首选 provider；'auto' 或不传 = 只用免费内置
 * @param {string} [opts.key]       对应 provider 的 API Key
 * @param {number} [opts.limit]     结果条数
 * @returns {Promise<{results:Array, provider:string, tried:string[], errors:string[]}>}
 */
export async function searchWeb(query, opts = {}) {
  const q = String(query || '').trim();
  const limit = Math.max(1, Math.min(20, Number(opts.limit) || 8));
  const errors = [];
  const tried = [];

  if (!q) return { results: [], provider: 'none', tried, errors: ['查询为空'] };

  const requested = String(opts.provider || 'auto').toLowerCase();
  const key = String(opts.key || '').trim();

  // 1. 用户指定了「要 key 的源」并且填了 key —— 直接用，它比免费源稳得多
  if (requested !== 'auto' && PROVIDERS[requested]) {
    const p = PROVIDERS[requested];
    if (!p.needsKey) {
      // 指定了一个免费源：先单独试它，失败再走竞速
      tried.push(requested);
      try {
        const results = await p.run(q, '', limit);
        if (results && results.length && (!p.needsKey && isRelevant(results, q))) {
          return { results, provider: requested, tried, errors };
        }
        errors.push(p.label + '：没有可用结果');
      } catch (err) {
        errors.push(p.label + '：' + (err && err.message ? err.message : String(err)));
      }
    } else if (key) {
      tried.push(requested);
      try {
        const results = await p.run(q, key, limit);
        if (results && results.length) {
          return { results, provider: requested, tried, errors };
        }
        errors.push(p.label + '：没有返回结果');
      } catch (err) {
        errors.push(p.label + '：' + (err && err.message ? err.message : String(err)));
      }
    } else {
      errors.push(p.label + '：没有填 API Key，已改用免费源');
    }
  }

  // 2. 免费源并发竞速
  const hit = await raceFreeProviders(q, limit, errors, tried);
  if (hit) return { results: hit.results, provider: hit.provider, tried, errors };

  return { results: [], provider: 'none', tried, errors };
}

/** 供界面渲染搜索源下拉用 */
export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    needsKey: p.needsKey,
    keyHint: p.keyHint || ''
  }));
}

/* ------------------------------------------------------------------ */
/* 连通性探测                                                           */
/* ------------------------------------------------------------------ */

/**
 * 每个 provider 探哪个端点。故意不带 key：
 * 返回 401/403 说明「网络通、只是缺 key」，这就是可达；
 * 超时/连接失败才是真的不通。
 */
const PROBES = {
  so360: () => ({ method: 'GET', url: 'https://www.so.com/s?q=test' }),
  bingrss: () => ({ method: 'GET', url: 'https://www.bing.com/search?format=rss&q=test' }),
  bing: () => ({ method: 'GET', url: 'https://www.bing.com/search?q=test' }),
  duckduckgo: () => ({ method: 'GET', url: 'https://lite.duckduckgo.com/lite/?q=test' }),
  bocha: () => ({
    method: 'POST',
    url: 'https://api.bochaai.com/v1/web-search',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test', count: 1 })
  }),
  tavily: () => ({
    method: 'POST',
    url: 'https://api.tavily.com/search',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test' })
  }),
  serper: () => ({
    method: 'POST',
    url: 'https://google.serper.dev/search',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'test' })
  }),
  brave: () => ({ method: 'GET', url: 'https://api.search.brave.com/res/v1/web/search?q=test' }),
  exa: () => ({
    method: 'POST',
    url: 'https://api.exa.ai/search',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test', numResults: 1 })
  }),
  firecrawl: () => ({
    method: 'POST',
    url: 'https://api.firecrawl.dev/v1/search',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test', limit: 1 })
  }),
  serpapi: () => ({ method: 'GET', url: 'https://serpapi.com/search.json?q=test' })
};

function classifyStatus(status) {
  if (status >= 200 && status < 300) return { reachable: true, note: '可达' };
  if (status === 401 || status === 403) return { reachable: true, note: '可达（需要 Key）' };
  if (status === 400 || status === 422) return { reachable: true, note: '可达（参数不全）' };
  if (status === 429) return { reachable: true, note: '可达（被限流）' };
  if (status === 404) return { reachable: false, note: '端点不存在（HTTP 404）' };
  if (status >= 500) return { reachable: true, note: '服务端错误（HTTP ' + status + '）' };
  return { reachable: true, note: 'HTTP ' + status };
}

/** 并发探测所有 provider */
export async function checkProviders() {
  const list = Object.values(PROVIDERS).filter((p) => PROBES[p.id]);
  const results = await Promise.all(list.map(async (p) => {
    const t0 = Date.now();
    try {
      const probe = PROBES[p.id]();
      const res = await fetchWithTimeout(probe.url, {
        method: probe.method,
        headers: probe.headers || {},
        body: probe.body
      }, 9000);
      const info = classifyStatus(res.status);
      return {
        id: p.id,
        label: p.label,
        needsKey: p.needsKey,
        reachable: info.reachable,
        status: res.status,
        note: info.note,
        ms: Date.now() - t0
      };
    } catch (err) {
      const msg = String((err && err.message) || err);
      const timedOut = /abort|timeout/i.test(msg);
      return {
        id: p.id,
        label: p.label,
        needsKey: p.needsKey,
        reachable: false,
        status: 0,
        note: timedOut ? '连接超时' : '连接失败：' + msg.slice(0, 60),
        ms: Date.now() - t0
      };
    }
  }));

  return results.sort((a, b) => Number(b.reachable) - Number(a.reachable));
}
