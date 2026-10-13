@echo off
rem AI Chess: double-click to play. Needs Python 3.10+ (no extra packages), or use ai-chess.exe from the Releases page.
setlocal
cd /d "%~dp0"
set PY=
if not defined PY ( where py >nul 2>nul && set PY=py -3 )
if not defined PY ( where python >nul 2>nul && set PY=python )
if not defined PY (
  echo Python 3.10 or newer is needed: https://www.python.org/downloads/
  echo Or download ai-chess.exe from https://github.com/BrandScape-Media/ai-chess/releases
  pause
  exit /b 1
)
%PY% server.py %*
if errorlevel 1 pause
