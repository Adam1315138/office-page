<#
  安装后验证（只读）

  用途：确认新装的 Office 版本对不对、有没有激活、能不能支撑 PPT 选区改写，
        以及我们那个加载项的注册还在不在。

  运行：
    powershell -ExecutionPolicy Bypass -File tools\verify-office.ps1

  说明：PowerPointApi 的准确上限只能在加载项里实测，这里按微软官方
        「Requirement sets」表的构建号门槛做推算，并给出实测方法。
#>

$ErrorActionPreference = 'Continue'
$ok = 0
$warn = 0
$bad = 0

function Line { param([string]$t = '') Write-Output $t }
function Head { param([string]$t)
  Line ''
  Line ('-' * 58)
  Line "  $t"
  Line ('-' * 58)
}
function Pass { param([string]$t) Line ("  [OK]   " + $t); $script:ok++ }
function Note { param([string]$t) Line ("  [注意] " + $t); $script:warn++ }
function Fail { param([string]$t) Line ("  [问题] " + $t); $script:bad++ }

Line 'Office 安装后验证'
Line ('时间: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# ---------------------------------------------------------------- 版本
Head '1. Office 版本'

$c2r = 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
$build = $null
$products = ''
$channel = ''

if (Test-Path $c2r) {
  $v = Get-ItemProperty $c2r
  $build = $v.VersionToReport
  $products = $v.ProductReleaseIds
  $channel = $v.CDNBaseUrl
  Line ("  报告版本: " + $build)
  Line ("  产品:     " + $products)
  Line ("  通道:     " + $channel)

  $major = 0
  if ($build -match '^16\.0\.(\d+)') { $major = [int]$Matches[1] }

  if ($major -ge 17000) {
    Pass ("版本较新（构建 " + $major + "），对应 Office 2024 或 Microsoft 365")
  } elseif ($major -ge 14300 -and $major -lt 17000) {
    Note ("构建 " + $major + " 仍是 2021 时代（Office 2021 / LTSC 2021），PPT 选区改写会不可用")
  } else {
    Note ("构建 " + $major + " 偏旧，请确认装的是目标版本")
  }
} else {
  Fail '没读到 ClickToRun 配置 —— Office 可能没装好，或者不是即点即用版本'
}

# ---------------------------------------------------------------- 激活
Head '2. 激活状态'

$lic = Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Office|Visio|Project' }

$kmsLeft = $false
if ($lic) {
  foreach ($l in $lic) {
    $st = switch ($l.LicenseStatus) {
      0 { '未授权' }
      1 { '已激活' }
      2 { '宽限期' }
      5 { '通知模式（未激活）' }
      default { "代码 $($l.LicenseStatus)" }
    }

    # 判断是不是历史残留（Grace 版、宽限期记录都是没激活干净的残留）
    $isLeftover = $false
    if ($l.Name -match 'Grace') { $isLeftover = $true }

    Line ("  " + $l.Name)
    Line ("    状态: " + $st + "   渠道: " + $l.ProductKeyChannel)
    if ($l.KeyManagementServiceMachine) {
      Line ("    KMS: " + $l.KeyManagementServiceMachine)
      $kmsLeft = $true
    }

    if ($isLeftover) {
      Note '这是历史残留（未激活的 Grace 记录），不是当前安装的产品；装完新版本建议清掉'
    } elseif ($l.LicenseStatus -eq 1) {
      Pass '该项已激活'
    } else {
      Fail ('该项未激活: ' + $l.Name)
    }
  }
  if ($kmsLeft) {
    Note '仍有 KMS 记录。如果新版本是零售/订阅，这些旧记录建议清掉，避免以后掉激活'
  }
} else {
  Fail '未查到任何 Office 授权记录'
}

# ---------------------------------------------------------------- PPT 能力推算
Head '3. PPT 选区改写能力（推算）'

$majorBuild = 0
if ($build -and $build -match '^16\.0\.(\d+)') { $majorBuild = [int]$Matches[1] }

Line '  官方门槛（微软 Requirement sets 表）：'
Line '    PowerPointApi 1.2  ->  构建 13426 起（Office 2021）'
Line '    PowerPointApi 1.5  ->  构建 15601 起（Office 2024 / M365）'
Line ''

if ($majorBuild -ge 15601) {
  Pass '构建号已达到 1.5 门槛，getSelectedTextRange 应该可用（PPT 能框选改写）'
} elseif ($majorBuild -ge 13426) {
  Fail '构建号只到 1.2 门槛：PPT 读不了选中文字，只能对话 + 读幻灯片文字'
} else {
  Note '构建号无法判定，请按下面的实测方法确认'
}

Line ''
Line '  实测方法（构建号只是推算，这个才是准的）：'
Line '    1) 打开 PowerPoint，插入 -> 我的加载项 -> 选 Office Copilot'
Line '    2) 选中一段文字，看侧边栏顶部选区条是否显示出文字'
Line '    3) 能显示 = 1.5 可用；提示"不支持读取选中文字" = 版本不够'

# ---------------------------------------------------------------- 加载项
Head '4. 加载项注册状态'

$tc = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs'
if (Test-Path $tc) {
  $found = $false
  Get-ChildItem $tc -ErrorAction SilentlyContinue | ForEach-Object {
    $x = Get-ItemProperty $_.PSPath
    if ($x.Url) { Line ("  受信任目录: " + $x.Url + "  Flags=" + $x.Flags); $found = $true }
  }
  if ($found) { Pass '受信任目录还在（升级 Office 通常不会清掉 HKCU）' }
  else { Note '受信任目录为空，需要在 Word 里重新添加共享文件夹' }
} else {
  Note '没有受信任目录配置 —— 升级后需要重新走一遍共享文件夹侧载'
}

$share = '\\' + $env:COMPUTERNAME + '\office-addins'
if (Test-Path $share) {
  $xmls = @(Get-ChildItem $share -Filter '*.xml' -ErrorAction SilentlyContinue)
  Pass ("共享目录可访问，manifest 数量: " + $xmls.Count)
} else {
  Note ('共享目录访问不到: ' + $share + '（SMB 共享可能在升级后需要重新建）')
}

# ---------------------------------------------------------------- 服务
Head '5. 本地服务与自启'

try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
  Pass '本地服务在跑（' + $r.StatusCode + '）'
} catch {
  Note '本地服务没跑。对话仍可用（直连模型），但联网搜索不可用；重启电脑或手动跑 start.bat'
}

$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'OfficeCopilotServer.vbs'
if (Test-Path $vbs) { Pass '开机自启文件还在' } else { Note '开机自启文件不见了，需要重新安装' }

# ---------------------------------------------------------------- 结论
Head '6. 结论'
Line ("  通过: " + $ok + "   注意: " + $warn + "   问题: " + $bad)
Line ''
if ($bad -eq 0 -and $warn -eq 0) {
  Line '  全部正常，可以直接开始用。'
} elseif ($bad -eq 0) {
  Line '  基本可用，按上面的「注意」项处理即可。'
} else {
  Line '  有需要处理的问题，见上面标 [问题] 的条目。'
}
