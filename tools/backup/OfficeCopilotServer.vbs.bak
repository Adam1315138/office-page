' Office Copilot 本地服务 —— 静默启动器
' 作用：开机自动在后台跑 server.mjs，不弹黑窗口。
' 如果端口已被占用（服务已在跑），server.mjs 会自己静默退出，不会报错。
Option Explicit

Dim sh, fso, projDir, nodeExe, cmd

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projDir = "D:\WorkBuddy\2026-10-27-21-19-30\office-copilot"

' 固定用扩展自带的 Node，避免 PATH 变化导致启动失败
nodeExe = "C:\Users\rwzz1\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

If Not fso.FolderExists(projDir) Then WScript.Quit 0

sh.CurrentDirectory = projDir

' 第二个参数 0 = 隐藏窗口；第三个参数 False = 不等待
On Error Resume Next
sh.Run """" & nodeExe & """ server.mjs", 0, False
