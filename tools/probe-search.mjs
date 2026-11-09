/**
 * 搜索后端探针：确认每个免费源能不能真的拿到结果，以及结果质量。
 * 用法：node tools/probe-search.mjs
 */
const QUERIES = ['苏菲的世界 内容简介', 'Office Add-in manifest 格式'];

const SOURCES = {
  'bing-rss': (q) => 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q),
  'so360': (q) => 'https://www.so.com/s?q=' + encodeURIComponent(q),
  'bing-html': (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=zh-CN',
};

function parseBingRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => {
      const mm = m[1].match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
      if (!mm) return '';
      return mm[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    };
    const title = pick('title');
    const url = pick('link');
    if (title && /^https?:\/\//.test(url)) out.push({ title, url, snippet: pick('description') });
  }
  return out;
}

function parseSo360(html) {
  const out = [];
  const s = String(html);
  for (const block of s.split(/<li class="res-list/).slice(1)) {
    const h = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!h) continue;
    const a = h[1].match(/href="([^"]+)"/);
    const title = h[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    if (!a || !title) continue;
    let url = a[1];
    if (url.startsWith('/')) url = 'https://www.so.com' + url;
    const p = block.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/) || block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title, url, snippet: p ? p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '' });
    if (out.length >= 8) break;
  }
  return out;
}

function parseBingHtml(html) {
  const out = [];
  for (const block of String(html).split(/<li class="b_algo"/).slice(1)) {
    const m = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    if (/bing\.com\//.test(m[1])) continue;
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ title, url: m[1], snippet: p ? p[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '' });
    if (out.length >= 8) break;
  }
  return out;
}

const PARSERS = { 'bing-rss': parseBingRss, so360: parseSo360, 'bing-html': parseBingHtml };

for (const [name, makeUrl] of Object.entries(SOURCES)) {
  for (const q of QUERIES) {
    try {
      const res = await fetch(makeUrl(q), {
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' }
      });
      const text = await res.text();
      const items = PARSERS[name](text);
      const hit = items.filter((r) => {
        const t = (r.title + ' ' + r.snippet).toLowerCase();
        const ql = q.toLowerCase();
        return ql.split(/\s+/).some((w) => w.length > 1 && t.includes(w));
      }).length;
      console.log(`[${name}] "${q}" status=${res.status} len=${text.length} 解析=${items.length} 命中=${hit}`);
      if (items[0]) console.log(`    1. ${items[0].title.slice(0, 50)} | ${items[0].url.slice(0, 70)}`);
    } catch (e) {
      console.log(`[${name}] "${q}" FAIL ${e.message.slice(0, 60)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
