@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   Creator Guard - 规则层测试模式
echo   不调用 Ollama，只验证界面和规则
echo ==========================================
echo.
set CG_LLM_BACKEND=mock
call start.bat
