@echo off
chcp 65001 >nul
echo ============================================
echo    Office 升级前体检（只读，不改任何东西）
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-before-upgrade.ps1"
echo.
echo 按任意键关闭...
pause >nul
