@echo off
rem Builds dist\ai-chess.exe (one file, no console window) with PyInstaller in a private venv (.build\venv).
setlocal
cd /d "%~dp0"
set PY=python
if not exist ".build\venv\Scripts\python.exe" (
  %PY% -m venv .build\venv || goto :err
  ".build\venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check pyinstaller zstandard || goto :err
)
rem zstandard unpacks the optional lichess puzzle download; older build folders get it here
".build\venv\Scripts\python.exe" -c "import zstandard" 2>nul || ".build\venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check zstandard || goto :err
rem Stockfish ships inside the program (downloaded once into .build\bundle); without internet the build goes on without it
if not exist ".build\bundle\stockfish" ".build\venv\Scripts\python.exe" tools\bundle_stockfish.py .build\bundle
set SF=
if exist ".build\bundle\stockfish" set SF=--add-data "%~dp0.build\bundle\stockfish;engines\stockfish"
".build\venv\Scripts\pyinstaller.exe" --noconfirm --log-level WARN --onefile --windowed --name ai-chess --icon "%~dp0assets\ai-chess.ico" --add-data "%~dp0web;web" %SF% --exclude-module zstandard.backend_cffi --exclude-module zstandard._cffi --distpath "%~dp0dist" --workpath .build\work --specpath .build server.py || goto :err
echo Built %~dp0dist\ai-chess.exe
goto :eof
:err
echo Build failed.
pause
