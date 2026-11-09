/**
 * 引用角标与来源列表的渲染检查
 * 用法: node tools/check-citations.mjs   （需要本地服务在跑）
 */
import { createRequire } from 'node:module';

const require = createRequire('file:///C:/Users/rwzz1/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:3000/taskpane.html?debug=1';

let pass = 0;
let fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass += 1; console.log('[PASS] ' + msg); } else { fail += 1; console.log('[FAIL] ' + msg + (extra ? ' —— ' + extra : '')); }
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

check(await page.evaluate(() => !!window.__oc), '调试钩子已暴露');

const sources = [
  { title: '苏菲的世界（百度百科）', url: 'https://baike.baidu.com/item/苏菲的世界' },
  { title: '知乎专栏：苏菲的世界讲了什么', url: 'https://zhuanlan.zhihu.com/p/123' },
  { title: '维基百科 Sophie', url: 'https://zh.wikipedia.org/wiki/Sophie' },
];

const out = await page.evaluate((srcs) => {
  const box = document.createElement('div');
  box.className = 'body';
  box.innerHTML = '<p>这是正文<strong>带加粗</strong>，参考 [1] 和 [3]，还有一个越界的 [9]。</p>'
    + '<pre><code>const x = "[1]";</code></pre>';
  document.body.appendChild(box);
  window.__oc.applyCitations(box, srcs);

  return {
    citeCount: box.querySelectorAll('a.cite').length,
    citeTexts: Array.from(box.querySelectorAll('a.cite')).map((a) => a.textContent),
    citeHrefs: Array.from(box.querySelectorAll('a.cite')).map((a) => a.getAttribute('href')),
    sourceBlock: !!box.querySelector('.sources'),
    sourceCount: box.querySelectorAll('.source-item').length,
    sourceTitles: Array.from(box.querySelectorAll('.source-item a')).map((a) => a.textContent),
    codeUntouched: box.querySelector('code').textContent,
    strongKept: !!box.querySelector('strong'),
  };
}, sources);

check(out.citeCount === 2, '只替换正文中的有效角标（[1][3]，越界的 [9] 不动），实际 ' + out.citeCount);
check(out.citeTexts.join(',') === '[1],[3]', '角标文本正确: ' + out.citeTexts.join(','));
check(out.citeHrefs[0] === sources[0].url, '角标链接指向第 1 条来源');
check(out.citeHrefs[1] === sources[2].url, '角标链接指向第 3 条来源');
check(out.sourceBlock, '末尾生成了来源区块');
check(out.sourceCount === 3, '来源列表条数 = 3，实际 ' + out.sourceCount);
check(out.sourceTitles[0] === sources[0].title, '来源标题正确: ' + out.sourceTitles[0]);
check(out.codeUntouched === 'const x = "[1]";', '代码块里的 [1] 没被误改');
check(out.strongKept, '原有加粗格式保留');

// 没有来源时不应生成空区块
const empty = await page.evaluate(() => {
  const box = document.createElement('div');
  box.className = 'body';
  box.innerHTML = '<p>参考 [1]</p>';
  document.body.appendChild(box);
  window.__oc.applyCitations(box, []);
  return { cite: box.querySelectorAll('a.cite').length, block: !!box.querySelector('.sources') };
});
check(empty.cite === 0 && empty.block === false, '无来源时不生成任何角标和区块');

check(errors.length === 0, '无 JS 报错', errors.slice(0, 2).join(' | '));

await browser.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
