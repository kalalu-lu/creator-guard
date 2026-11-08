@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo   Creator Guard - 本地私信/评论分类服务
echo ==========================================
echo.

set "PYTHON=python"
py -3 --version >nul 2>nul
if not errorlevel 1 set "PYTHON=py -3"
%PYTHON% --version >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到可用的 Python。
  echo 请先安装 Python 3.10 或更高版本，安装时勾选 "Add python.exe to PATH"。
  echo 下载地址：https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

%PYTHON% -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo [错误] Python 版本太低，需要 3.10 或更高版本。
  echo 当前版本：
  %PYTHON% --version
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] 第一次运行，正在创建 Python 虚拟环境...
  %PYTHON% -m venv .venv
  if errorlevel 1 (
    echo [错误] 创建虚拟环境失败。
    pause
    exit /b 1
  )
)

if not exist ".venv\.cg_ready" (
  echo [2/3] 正在安装依赖（第一次会慢一点）...
  set PIP_NO_CACHE_DIR=1
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r server\requirements.txt
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请把上面的报错发给我。
    pause
    exit /b 1
  )
  echo ready> ".venv\.cg_ready"
)

echo [3/3] 启动本地服务：http://127.0.0.1:8765
echo.
echo 这个窗口不要关。关掉它，浏览器扩展就分析不了。
echo 浏览器扩展里填写的地址也必须是 http://127.0.0.1:8765
echo.

start "" /b cmd /c "ping 127.0.0.1 -n 3 >nul & start http://127.0.0.1:8765"
".venv\Scripts\python.exe" -m uvicorn server.app:app --host 127.0.0.1 --port 8765

echo.
echo 服务已停止。
pause
