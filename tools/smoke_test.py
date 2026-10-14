"""Starts a built program and checks it works: the page, the API, and the Stockfish that ships inside it.

    python tools/smoke_test.py dist/ai-chess-linux

Used by the release build on Windows, Linux and macOS. GPL-3.0-or-later.
"""
import json
import subprocess
import sys
import tempfile
import time
import urllib.request

PORT = 8897


def get(path, body=None, timeout=10):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main():
    exe = sys.argv[1]
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as data:
        p = subprocess.Popen([exe, "--no-browser", "--port", str(PORT), "--data", data, "--exit-when-idle", "0"])
        try:
            t0 = time.time()
            while True:
                try:
                    health = json.loads(get("/api/health"))
                    break
                except OSError:
                    if time.time() - t0 > 90 or p.poll() is not None:
                        raise SystemExit("the program did not start")
                    time.sleep(1)
            print("health", health)
            page = get("/").decode()
            assert "AI Chess" in page, "the page did not load"
            cfg = json.loads(get("/api/config"))
            print("version", cfg.get("version"))
            pz = json.loads(get("/api/puzzles"))   # a build that lost zstandard couldn't unpack the puzzle download
            print("puzzle database decoder", pz.get("zstd"))
            assert pz.get("zstd"), "the program cannot unpack the lichess puzzle download: zstandard is missing from the build"
            while True:   # Stockfish is set up from the copy inside the program
                r = json.loads(get("/api/engines"))
                if any(e["id"] == "stockfish" for e in r["installed"]):
                    break
                job = r["jobs"].get("stockfish", {})
                if job.get("state") == "error" or time.time() - t0 > 240:
                    raise SystemExit(f"Stockfish was not set up: {job}")
                time.sleep(1)
            sf = next(e for e in r["installed"] if e["id"] == "stockfish")
            print("stockfish", sf["name"], sf["path"])
            go = json.loads(get("/api/engine/go", {"engine": "stockfish", "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                                                   "moves": [], "movetime": 300, "slot": "analysis"}, timeout=60))
            print("bestmove", go.get("bestmove"), go.get("info", {}).get("depth"))
            assert go.get("bestmove"), "Stockfish gave no move"
            print("smoke test passed")
        finally:   # the program and the engines it started
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
            else:
                p.terminate()
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()
