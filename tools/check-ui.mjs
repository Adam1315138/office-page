/**
 * 用真实 Edge 检查加载项界面（不在 Office 里，走"预览模式"分支）
 */
import { createRequire } from 'node:module';
const require = createRequire('file:///C:/Users/rwzz1/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:3000/taskpane.html';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 720 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);

const info = await page.evaluate(() => ({
  hostTag: (document.getElementById('host-tag') || {}).textContent,
  selText: (document.getElementById('sel-text') || {}).textContent,
  quickCount: document.querySelectorAll('.quick').length,
  hasInput: !!document.getElementById('input'),
  hasDrawer: !!document.getElementById('drawer'),
  drawerOpen: !(document.getElementById('drawer') || {}).hidden,
  officeApiReady: typeof window.OfficeAPI === 'object',
  aiReady: typeof window.AI === 'object',
  mdReady: typeof window.MD === 'object',
  bodyBg: getComputedStyle(document.body).backgroundColor
}));

console.log('=== 界面状态 ===');
for (const [k, v] of Object.entries(info)) console.log('  ' + k + ':', v);
console.log('\n=== 控制台错误 ===');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '  无');

await page.screenshot({ path: 'D:/WorkBuddy/2026-10-27-21-19-30/office-copilot/ui-settings.png' });
console.log('\n截图: ui-settings.png');

// 关掉设置，截主界面
await page.evaluate(() => {
  document.getElementById('drawer').hidden = true;
  document.getElementById('drawer-mask').hidden = true;
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'D:/WorkBuddy/2026-10-27-21-19-30/office-copilot/ui-main.png' });
console.log('截图: ui-main.png');

// 测一下 markdown 渲染
const mdTest = await page.evaluate(() => {
  const out = window.MD.render('**加粗** 和 `代码`\n\n- 项目一\n- 项目二\n\n<script>alert(1)</script>');
  return out;
});
console.log('\n=== Markdown 渲染 & XSS ===');
console.log('  含 <script>:', mdTest.includes('<script'));
console.log('  含加粗:', mdTest.includes('<strong>'));
console.log('  含列表:', mdTest.includes('<li>'));

await browser.close();
