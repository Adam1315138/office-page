@echo off
chcp 65001 >nul
echo ============================================
echo    Office 安装后验证（只读）
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-office.ps1"
echo.
echo 按任意键关闭...
pause >nul
