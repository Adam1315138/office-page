# Office Copilot · 中文 AI 文档助手

在 Word / Excel / PowerPoint 里选中一段文字，跟它说"改得更正式""翻成英文""压缩到 100 字"，它改好给你看，点一下写回文档。

**只需要一个 DeepSeek API Key**，联网搜索由本地服务代劳，不用再配任何搜索 API。

---

## 三步装好

### ① 本地服务（已配置成开机自启，不用管）

服务已经注册到 Windows 启动文件夹，**开机自动在后台跑，没有黑窗口，不需要手动双击任何东西**。

| 项 | 值 |
|---|---|
| 自启文件 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OfficeCopilotServer.vbs` |
| 启动方式 | `wscript` 隐藏窗口运行 `server.mjs`，不弹控制台 |
| 重复启动 | 端口被占时自动静默退出，不会报错弹窗 |
| 想取消 | 删掉上面那个 vbs 文件，重启后不再自启 |
| 想手动起 | 双击 `start.bat`（会显示窗口，便于看日志） |

服务只做两件事：托管加载项页面、代发搜索请求。**它挂了不影响对话**——聊天是直连 DeepSeek 的，只有「联网搜索」会不可用。

### ② 把 manifest 放进共享文件夹

三个文件在 `manifests/` 目录下：

| 文件 | 装到哪个应用 |
|---|---|
| `manifest-word.xml` | Word |
| `manifest-excel.xml` | Excel |
| `manifest-powerpoint.xml` | PowerPoint |

把它们复制到你的 Office 共享文件夹目录（本机已有 `\\RWZZ135138\office-addins`，对应 `D:\WorkBuddy\2026-10-27-21-19-30\office-addins\`）。

> **关于功能区按钮**：manifest 里的 `<VersionOverrides>` 决定了会不会在「开始」标签页出现 **智能助手 → Office Copilot** 按钮。
> 没有这段的话，加载项只会在 `插入 → 我的加载项` 里出现，点开是任务窗格，功能区什么也不显示（DeepL 那种有按钮的就是带了这段）。
> 旧的基础版 manifest 备份在 `manifests/basic/`，出问题直接覆盖回去即可。

如果那个共享还没建，用管理员 PowerShell 跑一次：

```powershell
New-SmbShare -Name "office-addins" -Path "D:\WorkBuddy\2026-10-27-21-19-30\office-addins" -ReadAccess "Everyone"
```

再在 Office 里信任它：

- 文件 → 选项 → 信任中心 → 信任中心设置 → **受信任的加载项目录**
- 添加 `\\你的电脑名\office-addins`，勾上「在菜单中显示」

### ③ 在 Word 里加载

1. 打开 Word（**先启动服务，再开 Word**）
2. 插入 → 我的加载项 → **共享文件夹**
3. 选 `Office Copilot` → 添加
4. 右侧出现任务窗格

首次打开会自动弹出设置，填：

| 字段 | 值 |
|---|---|
| Base URL | `https://api.deepseek.com/v1` |
| 模型名 | `deepseek-v4-flash` |
| API Key | 你的 `sk-...` |

---

## 怎么用

### 改写文档（核心功能）

1. 在文档里**框选一段文字**
2. 底部输入指令，比如：
   - `改得更正式`
   - `压缩到 100 字以内`
   - `翻译成英文`
   - `把这三条合并成一段`
3. 回车发送 → 它返回改写结果
4. **显示「原文 / 新文本」对比**，你看着满意再点 **应用到文档**
5. 不满意点「丢弃」，文档完全不动

> 默认是**预览模式**，不会直接改你的文档。想跳过预览直接写入，去设置里把「改文档前先预览」关掉。
> 写错了也能 `Ctrl+Z` 撤销。

### 问问题（不改文档）

不选文字直接问，或者问"这段有什么逻辑问题""帮我解释这个概念"这类，它会当对话回答，不会动文档。

### 联网搜索

底部勾上「允许联网」，它会先搜一轮再回答，答案里会标 `[1][2]` 对应来源。

搜索走本地服务的 `/api/search`，服务端直接请求，**不需要 Serper / Tavily / Brave 任何 key**。

免费源按实测结果排序，**并发竞速**——同时向所有免费源发请求，谁先拿到有效结果就用谁，10 秒硬上限：

| 源 | 实测情况 |
|---|---|
| **360 搜索** | 能出 5–6 条真结果，但连续提问会被风控（`fetch failed` / 超时） |
| **必应 RSS**（`format=rss`） | 干净 XML、10 条结果；被限流时会返回**完全无关的内容**（实测查"DeepSeek V4"返回"CloudFit 健身系统"） |
| 必应抓 HTML | 同上，且容易混进导航块 |
| DuckDuckGo | 当前网络下**完全不通** |

返回结果会过一道**相关性门禁**：标题+摘要必须命中查询词，否则丢弃——宁可搜不到，也不把垃圾喂给模型。

> ⚠️ **说实话**：这些站点都有反爬，免费抓取注定不稳定，尤其是连续对话时。真正稳定的做法是填一个搜索 Key（你手上已有 Tavily 的 key 的话，直接在设置里选 Tavily 填进去就行，之后永不被风控）。搜索失败时界面会显示每个源的真实失败原因，并给一个「去填搜索 Key」按钮。

#### 配置搜索源

设置面板「联网搜索」区域：

1. 点 **「测试各搜索源连通性」** → 会并发探测 9 个源，显示哪些可达、延迟多少
2. 点结果行可直接选中该源
3. 需要 key 的源会多出一个输入框，填进去保存即可

已实现的搜索源：

| 源 | 需要 Key | 说明 |
|---|---|---|
| 自动（免费内置） | 否 | 360 + 必应 RSS + 必应 + DDG 并发竞速，**会间歇失效** |
| **Tavily** | 是 | 你已有 key 的话首选，稳定 https://tavily.com |
| 博查 Bocha | 是 | **国内直连，最推荐** https://open.bochaai.com |
| Tavily | 是 | https://tavily.com |
| Serper | 是 | Google 结果，https://serper.dev |
| Brave | 是 | https://brave.com/search/api |
| Exa | 是 | 可读全文，https://exa.ai |
| Firecrawl | 是 | 爬虫式，https://firecrawl.dev |
| SerpAPI | 是 | https://serpapi.com |
| 自定义 | 是 | 改 `search.mjs` 里的 `custom` provider |

#### 想接自己的搜索 API

打开 `search.mjs`，找到最后的 `custom` provider，里面已经写好了示例代码（注释状态）。你的接口返回什么字段，就在 `map` 里对着改。界面里选「自定义」并填 key 就会走到这里。

#### 模型 API 不支持跨域怎么办

有些模型服务不返回 CORS 头，浏览器直连会被拦。两条路：

1. **勾上设置里的「请求经本地服务转发」** —— 请求绕一下本地 `/api/proxy`，**不需要自建任何外部代理**
2. 已经自建了 Cloudflare Worker 之类的外部代理？直接在 Base URL 里填那个代理地址（格式是 OpenAI 兼容的即可）

本地转发有域名白名单（`server.mjs` 的 `PROXY_ALLOWED_HOSTS`），只放行已知的模型服务，避免这个端口变成任意翻墙工具。想加自己的服务，往数组里加域名。

### 快捷按钮

| 按钮 | 作用 |
|---|---|
| 润色文字 | 通顺自然，意思不变 |
| 改得更正式 | 更书面 |
| 压缩精简 | 保留关键信息，砍冗余 |
| 扩写补充 | 补细节和论证 |
| 翻译成英文 | 地道英文 |
| 总结全文大纲 | 需要勾「带上全文」 |

---

## 跟 office-agents 比

| | office-agents | 本项目 |
|---|---|---|
| 界面语言 | 英文 | **全中文** |
| 搜索 | 要自备 Serper/Exa key，且需 CORS 代理 | **零配置，本地服务代抓** |
| 版本要求 | `WordApi 1.3` | **`WordApi 1.1`**，Office 2016+ 都能跑 |
| 模型名 | 需自己填对 | 预填 `deepseek-v4-flash` |
| 改文档 | 有，走审批 | 有，**预览对比 + 一键应用** |
| 依赖 | Svelte + pnpm 构建 | **纯 HTML/JS，零构建** |

---

## 已知限制

- **必须开着本地服务**。这是 `http://localhost` 托管的代价，换来的是不用注册任何云平台、代码不离开本机
- **PowerPoint 的选区读写做不了（Office 2021 / LTSC 的硬限制）**。读选中文字用的是 `getSelectedTextRange`，属于 `PowerPointApi 1.6`，只有 **Office 2024 / Microsoft 365** 才有；你这版 LTSC 2021 上限是 `PowerPointApi 1.2`。**重装同一版本没用**，只能升级到 2024 或 M365。当前 PPT 里能做的：对话、尽量读取幻灯片文字、跨页生成内容；做不到：框选 → 自动改。Word 和 Excel 不受影响。
- **Excel** 的"替换"只写左上角单元格，多格选区会提示
- 长文档按「全文最多带多少字」截断（默认 20000），避免超出模型上下文
- 扫描版 PDF 里的文字、图片里的字，读不到（Office 本身就没这个文本层）

---

## 开机自启（已装好）

已经不需要你做任何事。文件位置：

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OfficeCopilotServer.vbs
```

它用 `wscript` 隐藏窗口启动 `server.mjs`，所以**开机后不会看到任何窗口**。

- **想改端口/换 Node 路径**：编辑这个 vbs（源文件在 `tools/start-hidden.vbs`）
- **想取消自启**：删掉上面那个 vbs 文件即可
- **想确认服务在跑**：浏览器打开 `http://localhost:3000/api/health`，返回 `{"ok":true,...}` 就是正常

> 自启失败也不要紧：对话功能不依赖本地服务（直连 DeepSeek），只有联网搜索会不可用，界面上会明确提示。

---

## 换新版本 Office（2024 / M365）

只有一条原因需要升级：**PPT 的「框选改字」要 `PowerPointApi 1.5`**，Office 2021 / LTSC 2021 最高只有 1.2。Word 和 Excel 不受影响。

| 版本 | 构建号门槛 | PPT 选区 |
|---|---|---|
| Office 2021 / LTSC 2021 | 14334 左右 | ❌ |
| Office 2024 / LTSC 2024 | 15601+ | ✅ |
| Microsoft 365 | 15601+（且持续更新） | ✅ 最好 |

**两个只读脚本，升级前后各跑一次：**

```text
tools\check-before-upgrade.cmd    ← 卸载前：列出会被清掉的产品、需要备份的配置、KMS 残留
tools\verify-office.cmd           ← 安装后：版本、激活、PPT 能力推算、加载项注册、服务状态
```

双击就能跑（内部已带 `-ExecutionPolicy Bypass`，不需要改系统策略）。报告同时存到桌面。

> 注意：卸载 Office 会连 **Project / Visio** 一起清掉，升级前先确认这两个还要不要。

---

## 项目结构

```
office-copilot/
├── start.bat              一键启动
├── server.mjs             本地服务：静态托管 + 搜索代理
├── search.mjs             搜索源注册表（免费竞速 + 商业 API）
├── manifests/             三个 manifest（Word/Excel/PPT）
├── public/
│   ├── taskpane.html      界面
│   ├── taskpane.css       样式
│   ├── taskpane.js        主逻辑（选区 / 改写 / 预览 / 应用）
│   └── lib/
│       ├── office-api.js  Office.js 封装（Word/Excel/PPT 差异在这层）
│       ├── ai.js          DeepSeek 调用 + 搜索
│       └── markdown.js    Markdown 渲染（自带转义）
└── tools/                 图标生成、界面检查
```

**改功能从哪下手**：

- 换模型/厂商 → 设置里改 Base URL + 模型名，零代码
- 改快捷指令 → `taskpane.js` 里的 `QUICK_PROMPTS`
- 改改写风格 → `REWRITE_SYSTEM` 提示词
- 换搜索源 → `server.mjs` 的 `searchWeb()`
- 加 Excel/PPT 能力 → `lib/office-api.js` 对应分支

---

## 排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 加载项白屏 | 本地服务没启动 | 双击 `start.bat`，确认窗口在 |
| 提示"找不到加载项" | manifest 的 SourceLocation 指向 localhost，服务没起 | 同上 |
| 报 404 model not found | 模型名过期 | 改成 `deepseek-v4-flash` |
| 报 401 | API Key 错 | 重新填 |
| 搜索没结果 | 服务端抓取被限流 | 等一会再试，或换查询词 |
| 改了没生效 | 站点的 Office 缓存 | 重启 Word |

---

## 相关项目

| 项目 | 平台 | 做什么 |
|---|---|---|
| **Office Copilot**（本仓库） | Word / Excel / PowerPoint | 读当前文档、框选改字、联网检索 |
| [**Page Copilot**](https://github.com/Adam1315138/edge-page-copilot) | Edge 侧边栏扩展 | 读正在看的网页与 PDF，结合页面上下文回答 |

两个项目是同一套思路的两端：**自带 UI + 你自己的模型 Key**，不依赖厂商内置的 AI，也不经过任何中转服务。数据流向完全相同——只在你本机和模型 API 之间。

---

## 许可

[MIT](./LICENSE) © 2026 Adam1315138

可以自由使用、修改、分发，包括商用；保留版权声明即可。

---

v1.2.0 · 支持 localhost 与公网托管两种模式，不经过任何中转服务
