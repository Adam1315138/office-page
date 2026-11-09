/**
 * 一键切换加载项托管地址。
 *
 * 用法：
 *   node tools/set-host.mjs http://localhost:3000            # 切回本地服务
 *   node tools/set-host.mjs https://office-page.pages.dev    # 切到公网托管
 *
 * 做的事：
 *   1. 把 manifests/*.xml 里所有旧的托管地址换成新的
 *   2. 复制到共享目录（默认 \\<机器名>\office-addins）
 *   3. 打印替换摘要，方便核对
 *
 * 注意：改完必须重启 Office，它只在启动时读 manifest。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_DIR = path.join(ROOT, 'manifests');

/**
 * 目标目录解析。
 * 共享是只读的（建共享时只给了 Read），直接写 UNC 会 EPERM，
 * 所以要落到共享背后的本地目录。顺序：环境变量 → net share 查到的本地路径 → UNC。
 */
function resolveShareDir() {
  const candidates = [];
  if (process.env.OC_SHARE_DIR) candidates.push(process.env.OC_SHARE_DIR);

  // 共享目录一般是项目目录的兄弟目录（D:\...\office-addins）
  const sibling = path.resolve(ROOT, '..', 'office-addins');
  if (fs.existsSync(sibling)) candidates.push(sibling);

  candidates.push(path.join('\\\\' + os.hostname(), 'office-addins'));
  return candidates;
}

const SHARE_CANDIDATES = resolveShareDir();

const KNOWN_BASES = [
  'http://localhost:3000',
  'https://adam1315138.github.io/office-page',
];

const arg = (process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+/.test(arg)) {
  console.error('用法: node tools/set-host.mjs <baseUrl>');
  console.error('例如: node tools/set-host.mjs https://office-page.pages.dev');
  process.exit(1);
}

const files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.xml'));
if (files.length === 0) {
  console.error('manifests 目录里没有 xml');
  process.exit(1);
}

let changed = 0;
const summary = [];

for (const name of files) {
  const src = path.join(MANIFEST_DIR, name);
  let text = fs.readFileSync(src, 'utf8');
  const before = text;

  for (const base of KNOWN_BASES) {
    if (base === arg) continue;
    text = text.split(base).join(arg);
    // 处理带尾斜杠的写法
    text = text.split(base + '/').join(arg + '/');
  }

  if (text !== before) {
    fs.writeFileSync(src, text, 'utf8');
    changed += 1;
  }

  const hits = (text.match(new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  summary.push('  ' + name.padEnd(28) + ' 含新地址 ' + hits + ' 处');

  // 同步到共享目录（第一次成功的候选目录就固定下来）
  const shareName = 'office-copilot-' + name.replace('manifest-', '');
  let copied = false;
  for (const dir of SHARE_CANDIDATES) {
    const dst = path.join(dir, shareName);
    try {
      fs.copyFileSync(src, dst);
      summary.push('    → 已复制到 ' + dst);
      copied = true;
      break;
    } catch (err) {
      /* 试下一个候选 */
    }
  }
  if (!copied) {
    summary.push('    ✗ 复制失败（共享目录都写不进去，用法见 README）');
  }
}

console.log('托管地址: ' + arg);
console.log('共享目录候选:');
for (const d of SHARE_CANDIDATES) console.log('  - ' + d);
console.log('');
console.log(summary.join('\n'));
console.log('');
console.log(changed ? ('已改写 ' + changed + ' 个文件') : '内容无变化（地址本来就是它）');
console.log('');
console.log('下一步：完全关闭 Office 所有窗口，重新打开才会生效。');
