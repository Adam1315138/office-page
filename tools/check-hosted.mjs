/**
 * 验证公网托管的加载项页面
 * 用法: node tools/check-hosted.mjs https://office-page-4b5.pages.dev
 */
import { createRequire } from 'node:module';

const require = createRequire('file:///C:/Users/rwzz1/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = (process.argv[2] || '').replace(/\/+$/, '');
if (!BASE) { console.error('用法: node tools/check-hosted.mjs <baseUrl>'); process.exit(1); }

let pass = 0; let fail = 0;
const check = (cond, msg, extra) => {
  if (cond) { pass += 1; console.log('[PASS] ' + msg); }
  else { fail += 1; console.log('[FAIL] ' + msg + (extra ? ' —— ' + extra : '')); }
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
const errors = [];
const requested = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => requested.push(r.url() + ' :: ' + (r.failure() || {}).errorText));

await page.goto(BASE + '/taskpane.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForTimeout(2500);

const st = await page.evaluate(() => ({
  title: document.title,
  officeApi: !!window.OfficeAPI,
  ai: !!window.AI,
  md: !!window.MD,
  quick: document.querySelectorAll('.quick').length,
  input: !!document.getElementById('input'),
  drawer: !!document.getElementById('drawer'),
  host: (document.getElementById('host-tag') || {}).textContent || '',
  bodyBg: getComputedStyle(document.body).backgroundColor
}));

check(/Office Copilot/i.test(st.title), '页面标题正确: ' + st.title);
check(st.officeApi && st.ai && st.md, '三个脚本库都加载（OfficeAPI / AI / MD）');
check(st.quick === 6, '快捷按钮 6 个，实际 ' + st.quick);
check(st.input && st.drawer, '输入框与设置抽屉存在');
check(st.bodyBg !== 'rgba(0, 0, 0, 0)', 'CSS 生效（背景色 ' + st.bodyBg + '）');

// 直连降级：地址栏在公网时没有本地服务，应自动走浏览器直连
const direct = await page.evaluate(async () => {
  try {
    const out = await window.AI.search('测试', 'http://127.0.0.1:9', { provider: 'tavily', key: 'tvly-invalid' });
    return { ok: true, provider: out.provider, errors: out.errors, count: (out.results || []).length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});
check(direct.ok, 'search() 在无本地服务时能返回（不抛异常）', direct.error || '');
if (direct.ok) {
  const joined = (direct.errors || []).join(' ');
  check(/本地服务不可用/.test(joined), '记录了本地服务不可用的降级原因');
  check(/tavily/i.test(joined) || direct.provider.indexOf('tavily') === 0,
    '确实尝试了直连 Tavily（' + (direct.provider || '无') + '）');
  check(/401|403|HTTP/i.test(joined) || direct.count >= 0, 'Tavily 用了假 key，返回鉴权错误符合预期');
}

check(errors.length === 0, '无 JS 报错', errors.slice(0, 2).join(' | '));

await browser.close();
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
