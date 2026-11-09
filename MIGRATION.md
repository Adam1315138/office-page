# Office 迁移清单（2021 → 2024 / M365）

按顺序勾，别跳步。每一步都写了「做完怎么确认」。

当前状态（体检脚本实测）：

- 现有版本：**Office LTSC 2021**（ProPlus2021Volume，构建 16.0.14334.20974）
- 同时装着：**Project 2019**、**Visio 2019**（同为批量授权版）
- 激活方式：**KMS**（`kms.03k.org`）—— 卸载后不可回滚
- 有历史残留：`Office16O365HomePremR_Grace`（未激活的零售记录，装新版本前要清）
- 需要备份：`Normal.dotm`、`Word\STARTUP`

---

## 0. 先确认要不要继续

- [ ] 我确认 **Project 2019 / Visio 2019 可以一起卸掉**（卸载会连它们一起清）
- [ ] 我确认升级的目的：**PPT 框选改字**（Word / Excel 现在就能用）
- [ ] 已决定买 **Office 家庭版 2024（¥798）** 还是 **M365 个人版（¥398/年）**

> 家庭版 2024 不含 Outlook。要用 Outlook 邮件客户端，得买「家庭和商业版」或订阅 M365。

---

## 1. 卸载前体检

- [ ] 双击 `tools\check-before-upgrade.cmd`
- [ ] 看报告第 5 节，确认哪些个人配置需要备份
- [ ] 桌面会生成 `office-before-upgrade-时间戳.txt`，留着对照

---

## 2. 备份

- [ ] 文档目录整体复制一份（至少：文档、桌面、正在做的项目）
- [ ] 复制 `%APPDATA%\Microsoft\Templates\Normal.dotm`
- [ ] 复制 `%APPDATA%\Microsoft\Word\STARTUP`（里面是启动宏，有就备份）
- [ ] Office 里导出自定义功能区（文件 → 选项 → 自定义功能区 → 导入/导出）
- [ ] 记下当前版本号：`16.0.14334.20974`

---

## 3. 卸载（二选一）

### 方案 A：SaRA（推荐，微软官方）

- [ ] 打开 `tools\sara-office-removal`
- [ ] 地址栏输入 `cmd` 回车，进入该目录的命令行
- [ ] 执行（需要 UAC 管理员权限 + 联网）：

```
GetHelpCmd.exe /S OfficeScrubScenario /AcceptEula
```

- [ ] 等待跑完（几分钟），**中途不要关窗口**

### 方案 B：OTP（图形界面，SaRA 报错时用）

- [ ] 打开 `tools\otp\Office Tool\Office Tool Plus.exe`
- [ ] 左侧「工具箱」→「移除 Office」→ 选「全部移除」
- [ ] 等它跑完

### 卸载后确认

- [ ] `C:\Program Files\Microsoft Office` 目录已消失或为空
- [ ] 打开 `tools\verify-office.cmd`，第 1 节应显示「没读到 ClickToRun 配置」
- [ ] 如果第 2 节还残留 KMS 记录，重跑一次卸载

---

## 4. 安装

### 方案 A：微软账号安装（买零售版/订阅，推荐）

- [ ] 买好后到 `setup.office.com` 兑换 25 位密钥，绑到微软账号
- [ ] 打开 `account.microsoft.com` →「服务和订阅」→「安装」
- [ ] 下载运行，按提示装完
- [ ] 打开 Word → 文件 → 账户 → 登录微软账号

**为什么优先这个**：它自动装对产品 ID（Home 2024），不会出现「装成 ProPlus 导致 Home 密钥激活不上」的坑。

### 方案 B：OTP 安装（装 LTSC / 指定版本时用）

- [ ] 打开 `tools\otp\Office Tool\Office Tool Plus.exe`
- [ ] 「部署」→ 添加产品 → 选对应产品（如 **Office LTSC 标准版 2024**）
- [ ] 架构选 x64、通道选「LTSC 2024 永久企业通道」
- [ ] 开始部署，等下载安装完
- [ ] 安装后仍需授权（有正版密钥就填密钥；没有就别装，会一直是未激活）

> ⚠️ 买的是 **家庭版 2024 零售授权**时，不要用 OTP 选 ProPlus —— 产品对不上，密钥激活不了。

---

## 5. 验证

- [ ] 双击 `tools\verify-office.cmd`
- [ ] 第 1 节：构建号 **≥ 15601**（15601 以下 PPT 选区不可用）
- [ ] 第 2 节：激活状态「已激活」，渠道显示 Retail 或 M365
- [ ] 第 3 节：应显示 **[OK] 构建号已达到 1.5 门槛**
- [ ] 第 4 节：受信任目录 / 共享目录是否还在

### 实测 PPT 能力（唯一准确的判断）

- [ ] 打开 PowerPoint → 插入 → 我的加载项 → 选 `Office Copilot`
- [ ] 选中一段文字
- [ ] 侧边栏顶部选区条**显示出文字** = 成功
- [ ] 显示「不支持读取选中文字」= 版本还是不够，把 build 号发我

---

## 6. 恢复加载项

升级 Office 通常**不会清掉** HKCU 的受信任目录，共享文件夹也在（那是 Windows 的共享，与 Office 无关）。

- [ ] 打开 Word → 插入 → 我的加载项 → 看有没有「共享文件夹」
- [ ] 没有就用 2024 的「**上传我的加载项**」直接选 `manifests\manifest-word.xml`（2024 零售版有这个入口，比共享文件夹省事）
- [ ] 确认本地服务在跑：浏览器开 `http://localhost:3000/api/health`
- [ ] 自启文件还在：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OfficeCopilotServer.vbs`

---

## 7. 万一要回滚

- [ ] Office 2021 安装包从微软账号「服务和订阅」的历史版本里找，或用 OTP 装 LTSC 2021
- [ ] 但**授权回不去了** —— 原来的 KMS 激活已清，需要重新解决（这也是为什么建议先买再卸）

---

## 时间预估

| 阶段 | 耗时 |
|---|---|
| 体检 + 备份 | 20 分钟 |
| 卸载 | 5–15 分钟 |
| 安装 | 15–30 分钟（看网速） |
| 验证 + 恢复加载项 | 15 分钟 |
