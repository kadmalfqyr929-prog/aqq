@echo off
cd /d "%~dp0"
set "TOX_PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%TOX_PYTHON%" set "TOX_PYTHON=python"
"%TOX_PYTHON%" start_server.py
