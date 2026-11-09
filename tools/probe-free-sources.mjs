/**
 * 免费搜索源候选池探针。
 * 目标：找出「能被服务端直接抓、结果真实、不轻易风控」的源。
 * 用法：node tools/probe-free-sources.mjs
 */
const QUERY = '苏菲的世界 讲了什么';

const CANDIDATES = {
  'so360': 'https://www.so.com/s?q=',
  'bing-rss': 'https://www.bing.com/search?format=rss&q=',
  'cn-bing-rss': 'https://cn.bing.com/search?format=rss&q=',
  'mojeek': 'https://www.mojeek.com/search?q=',
  'ecosia': 'https://www.ecosia.org/search?q=',
  'm-baidu': 'https://m.baidu.com/s?word=',
  'startpage': 'https://www.startpage.com/sp/search?query=',
  'brave-html': 'https://search.brave.com/search?q=',
  'searx-be': 'https://searx.be/search?q=',
  'yandex': 'https://yandex.com/search/?text=',
  'sogou': 'https://www.sogou.com/web?query=',
};

function countSignals(html, url) {
  const t = String(html);
  const hits = {
    'msn': /<item>/.test(t) ? (t.match(/<item>/g) || []).length : 0,
    'so-res': (t.match(/class="res-list/g) || []).length,
    'mojeek-li': (t.match(/<li class="r\d?"/g) || []).length,
    'generic-a': (t.match(/<h2[^>]*>\s*<a |<h3[^>]*>\s*<a /g) || []).length,
  };
  return hits;
}

for (const [name, base] of Object.entries(CANDIDATES)) {
  const url = base + encodeURIComponent(QUERY);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    const text = await res.text();
    const sig = countSignals(text, url);
    const relevant = /苏菲|哲学|贾德|Sofie/i.test(text);
    console.log(
      `${name.padEnd(12)} status=${String(res.status).padEnd(4)} len=${String(text.length).padEnd(7)} `
      + `相关=${relevant ? 'Y' : 'N'} 信号=${JSON.stringify(sig)} ${Date.now() - t0}ms`
    );
  } catch (e) {
    console.log(`${name.padEnd(12)} FAIL ${String(e.message).slice(0, 50)} ${Date.now() - t0}ms`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
