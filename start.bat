@echo off
chcp 65001 >nul
title Office Copilot 本地服务
cd /d "%~dp0"

echo.
echo   ============================================
echo     Office Copilot 本地服务
echo   ============================================
echo.
echo   启动后请保持这个窗口打开，关掉服务就停了。
echo   按 Ctrl+C 可以停止。
echo.

where node >nul 2>nul
if %errorlevel%==0 (
    node server.mjs
) else (
    echo   系统 PATH 里没找到 node，尝试使用内置路径...
    "C:\Users\rwzz1\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" server.mjs
)

echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
