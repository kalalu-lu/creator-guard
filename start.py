#!/usr/bin/env python3
"""Creator Guard launcher that does not require a .bat file.

Usage (from PowerShell):
    cd C:\\CreatorGuard
    py -3 start.py
    # or
    python start.py

Why this exists:
Windows "Smart App Control" (智能应用控制) can block downloaded .bat files
outright. Running this Python script from a terminal is a practical fallback:
the Python interpreter is signed/known, and the script only creates a venv,
installs the project's own requirements, and starts uvicorn on localhost.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
IS_WINDOWS = os.name == "nt"
VENV_PYTHON = VENV / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
MARKER = VENV / ".cg_ready"
PORT = int(os.getenv("CG_PORT", "8765"))
HOST = "127.0.0.1"
URL = f"http://{HOST}:{PORT}"


def run(cmd: list[str], **kwargs) -> None:
    print("+ " + " ".join(str(part) for part in cmd), flush=True)
    subprocess.check_call(cmd, cwd=ROOT, **kwargs)


def ensure_python_version() -> None:
    if sys.version_info < (3, 10):
        raise SystemExit(
            f"需要 Python 3.10 或更高版本，当前是 {sys.version.split()[0]}。\n"
            "下载：https://www.python.org/downloads/windows/"
        )


def ensure_venv() -> None:
    if VENV.exists() and not VENV_PYTHON.exists():
        print("[提示] .venv 不完整，正在重建...", flush=True)
        shutil.rmtree(VENV, ignore_errors=True)

    if not VENV_PYTHON.exists():
        print("[1/3] 第一次运行，正在创建虚拟环境...", flush=True)
        run([sys.executable, "-m", "venv", str(VENV)])


def ensure_dependencies() -> None:
    if MARKER.exists():
        return

    print("[2/3] 正在安装依赖（第一次会慢一点）...", flush=True)
    env = os.environ.copy()
    env["PIP_NO_CACHE_DIR"] = "1"
    try:
        run([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"], env=env)
        run(
            [
                str(VENV_PYTHON),
                "-m",
                "pip",
                "install",
                "-r",
                str(ROOT / "server" / "requirements.txt"),
            ],
            env=env,
        )
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "\n依赖安装失败。请把上面的报错发给我；也可以先确认网络能访问 pypi.org。"
        ) from exc
    MARKER.write_text("ready\n", encoding="utf-8")


def open_browser_later() -> None:
    def _open() -> None:
        time.sleep(2.5)
        try:
            webbrowser.open(URL)
        except Exception:
            pass

    threading.Thread(target=_open, daemon=True).start()


def main() -> None:
    ensure_python_version()
    os.chdir(ROOT)
    print("=" * 42)
    print("  Creator Guard - 本地私信/评论分类服务")
    print("=" * 42)
    print()

    ensure_venv()
    ensure_dependencies()

    print(f"[3/3] 启动本地服务：{URL}", flush=True)
    print("这个窗口不要关。关掉它，浏览器扩展就分析不了。", flush=True)
    print(f"浏览器扩展地址必须填：{URL}", flush=True)
    print("接口文档：", f"{URL}/docs", flush=True)
    print()

    if "--no-browser" not in sys.argv and os.getenv("CG_NO_BROWSER") != "1":
        open_browser_later()

    try:
        code = subprocess.call(
            [
                str(VENV_PYTHON),
                "-m",
                "uvicorn",
                "server.app:app",
                "--host",
                HOST,
                "--port",
                str(PORT),
            ],
            cwd=ROOT,
        )
    except KeyboardInterrupt:
        print("\n已停止。", flush=True)
        return

    if code != 0:
        print(f"\n服务退出，退出码 {code}。", flush=True)
        print("常见原因：端口被占用、依赖损坏、或 Ollama/模型配置有误。", flush=True)
    else:
        print("\n服务已停止。", flush=True)


if __name__ == "__main__":
    main()
