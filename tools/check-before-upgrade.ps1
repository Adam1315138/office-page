<#
  升级前体检（只读，不改动任何东西）

  用途：在卸载现有 Office 之前，把「会被删掉的东西」「需要备份的配置」
        「当前激活残留」全部列清楚，避免卸完才发现漏了什么。

  运行：
    powershell -ExecutionPolicy Bypass -File tools\check-before-upgrade.ps1

  输出：屏幕摘要 + 一份报告存到桌面
#>

$ErrorActionPreference = 'Continue'
$report = New-Object System.Collections.Generic.List[string]

function Add-Line {
  param([string]$Text = '')
  Write-Output $Text
  $script:report.Add($Text)
}

function Add-Section {
  param([string]$Title)
  Add-Line ''
  Add-Line ('=' * 60)
  Add-Line "  $Title"
  Add-Line ('=' * 60)
}

Add-Line "Office 升级前体检报告"
Add-Line ("生成时间: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# ---------------------------------------------------------------- 系统
Add-Section '1. 系统'

$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) {
  Add-Line ("系统: " + $os.Caption)
  Add-Line ("版本: " + $os.Version + "  Build " + $os.BuildNumber)
  $dv = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue).DisplayVersion
  if ($dv) { Add-Line ("显示版本: " + $dv) }

  if ($os.BuildNumber -ge 22000) {
    Add-Line '判断: Windows 11 —— Office 2024 可支持到 2029-10'
  } else {
    Add-Line '判断: Windows 10 —— 已停止支持，Office 2024 装上去也不再获得更新'
  }
} else {
  Add-Line '无法读取系统信息'
}

# ---------------------------------------------------------------- 现有 Office
Add-Section '2. 现有 Office 版本'

$c2rPaths = @(
  'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Office\ClickToRun\Configuration'
)
$foundC2R = $false
foreach ($p in $c2rPaths) {
  if (Test-Path $p) {
    $foundC2R = $true
    $v = Get-ItemProperty $p
    Add-Line ("注册表: " + $p)
    Add-Line ("  报告版本: " + $v.VersionToReport)
    Add-Line ("  产品:     " + $v.ProductReleaseIds)
    Add-Line ("  平台:     " + $v.Platform)
    Add-Line ("  更新通道: " + $v.CDNBaseUrl)
  }
}
if (-not $foundC2R) { Add-Line '未找到 ClickToRun 配置（可能不是即点即用安装）' }

# ---------------------------------------------------------------- 授权与激活
Add-Section '3. 授权状态（重点看有没有 KMS 残留）'

$licenses = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Office|Visio|Project' }

$kmsFound = $false
if ($licenses) {
  foreach ($l in $licenses) {
    $status = switch ($l.LicenseStatus) {
      0 { '未授权' }
      1 { '已激活' }
      2 { '宽限期' }
      3 { '额外宽限' }
      4 { '非正版宽限' }
      5 { '通知模式（未激活）' }
      default { "代码 $($l.LicenseStatus)" }
    }
    Add-Line ("产品: " + $l.Name)
    Add-Line ("  状态: " + $status)
    Add-Line ("  渠道: " + $l.ProductKeyChannel)
    if ($l.KeyManagementServiceMachine) {
      Add-Line ("  KMS 服务器: " + $l.KeyManagementServiceMachine + "   <-- 卸载后必须确认清除")
      $kmsFound = $true
    }
  }
} else {
  Add-Line '未查到 Office 类授权记录'
}

if ($kmsFound) {
  Add-Line ''
  Add-Line '⚠ 检测到 KMS 激活。卸载后残留可能影响新版本激活，'
  Add-Line '  建议用 Office Tool Plus 的「移除 Office」或 SaRA Scrub 做彻底清理。'
}

# ---------------------------------------------------------------- 会被删掉的产品
Add-Section '4. 卸载后会被一起清掉的产品'

if ($licenses) {
  foreach ($l in $licenses) { Add-Line ("  - " + $l.Name) }
} else {
  Add-Line '  （无法枚举）'
}
Add-Line ''
Add-Line '提醒：Project / Visio 也在列表里的话，卸载后要重新安装并重新激活。'

# ---------------------------------------------------------------- 备份清单
Add-Section '5. 需要备份的个人配置（存在才列出）'

$backupTargets = [ordered]@{
  'Word 默认模板'      = "$env:APPDATA\Microsoft\Templates\Normal.dotm"
  'Word 启动宏'        = "$env:APPDATA\Microsoft\Word\STARTUP"
  'Excel 启动目录'     = "$env:APPDATA\Microsoft\Excel\XLSTART"
  'Excel 个人宏工作簿' = "$env:APPDATA\Microsoft\Excel\XLSTART\PERSONAL.XLSB"
  '自定义功能区'       = "$env:LOCALAPPDATA\Microsoft\Office\*.officeUI"
  '自动恢复文件'       = "$env:APPDATA\Microsoft\Word"
}
foreach ($k in $backupTargets.Keys) {
  $p = $backupTargets[$k]
  if (Test-Path $p) {
    Add-Line ("  [有] " + $k + "  ->  " + $p)
  } else {
    Add-Line ("  [无] " + $k)
  }
}

# ---------------------------------------------------------------- 加载项现状
Add-Section '6. 我们那个加载项的现状（升级后要恢复）'

$tc = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs'
if (Test-Path $tc) {
  Get-ChildItem $tc -ErrorAction SilentlyContinue | ForEach-Object {
    $v = Get-ItemProperty $_.PSPath
    Add-Line ("  受信任目录: " + $v.Url + "  (Flags=" + $v.Flags + ")")
  }
} else {
  Add-Line '  未配置受信任目录'
}

$share = '\\' + $env:COMPUTERNAME + '\office-addins'
if (Test-Path $share) {
  $xmls = Get-ChildItem $share -Filter '*.xml' -ErrorAction SilentlyContinue
  Add-Line ("  共享目录可访问: " + $share + "  （" + $xmls.Count + " 个 manifest）")
  foreach ($x in $xmls) { Add-Line ("    - " + $x.Name) }
} else {
  Add-Line ("  共享目录不可访问: " + $share + "（升级后需要重新确认共享）")
}

$wef = "$env:LOCALAPPDATA\Microsoft\Office\16.0\Wef"
if (Test-Path $wef) {
  $mf = Get-ChildItem $wef -Recurse -Directory -Filter 'Manifests' -ErrorAction SilentlyContinue
  foreach ($d in $mf) {
    $files = Get-ChildItem $d.FullName -File -ErrorAction SilentlyContinue
    Add-Line ("  Office 已解析的 manifest: " + $files.Count + " 个")
    foreach ($f in $files) { Add-Line ("    - " + $f.Name) }
  }
}

# ---------------------------------------------------------------- 服务
Add-Section '7. 本地服务'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
  Add-Line ("  运行中: " + $r.StatusCode)
} catch {
  Add-Line '  未运行（不影响升级，但升级后要确认自启文件还在）'
}

$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'OfficeCopilotServer.vbs'
if (Test-Path $vbs) { Add-Line ("  开机自启: 已安装 -> " + $vbs) } else { Add-Line '  开机自启: 未安装' }

# ---------------------------------------------------------------- 结论
Add-Section '8. 下一步'
Add-Line '1) 备份文档（文档/桌面/项目目录）'
Add-Line '2) 用 Office Tool Plus 的「移除 Office」清掉现有版本'
Add-Line '3) 装新版本，用微软账号登录激活'
Add-Line '4) 运行 tools\verify-office.ps1 验证结果'

# 存报告
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) ('office-before-upgrade-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.txt')
try {
  $report | Set-Content -Path $out -Encoding UTF8
  Write-Output ''
  Write-Output ("报告已保存: " + $out)
} catch {
  Write-Output ''
  Write-Output '报告保存失败（不影响上面的结果）'
}
