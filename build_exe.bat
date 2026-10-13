@echo off
rem Builds dist\ai-chess.exe (one file, no console window) with PyInstaller in a private venv (.build\venv).
setlocal
cd /d "%~dp0"
set PY=python
if not exist ".build\venv\Scripts\python.exe" (
  %PY% -m venv .build\venv || goto :err
  ".build\venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check pyinstaller || goto :err
)
".build\venv\Scripts\pyinstaller.exe" --noconfirm --log-level WARN --onefile --windowed --name ai-chess --icon "%~dp0assets\ai-chess.ico" --add-data "%~dp0web;web" --distpath "%~dp0dist" --workpath .build\work --specpath .build server.py || goto :err
echo Built %~dp0dist\ai-chess.exe
goto :eof
:err
echo Build failed.
pause
