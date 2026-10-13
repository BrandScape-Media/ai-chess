"""Downloads Stockfish for this computer into a folder, to ship it inside the program (used by the release build).

    python tools/bundle_stockfish.py bundle

leaves bundle/stockfish/ (the engine and its files, plus VERSION). It uses the app's own installer, so the build picked is the
one the in-app "Install" button would pick, tested to run on this machine. GPL-3.0-or-later; Stockfish is GPL-3.0 too.
"""
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from uci import CATALOG, Engines  # noqa: E402


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "bundle").resolve()
    with tempfile.TemporaryDirectory() as tmp:
        eng = Engines(tmp)
        eng.jobs["stockfish"] = {"state": "running", "step": "", "done": 0, "total": 0}
        eng._install(next(c for c in CATALOG if c["id"] == "stockfish"))
        e = eng.get("stockfish")
        if not e:
            raise SystemExit("Stockfish could not be installed: " + eng.jobs["stockfish"].get("step", ""))
        dest = out / "stockfish"
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(eng.dir / "stockfish", dest)
        (dest / "VERSION").write_text(e.get("version") or "", encoding="utf-8")
        size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
        print(f"{e['name']} ({e.get('version')}) -> {dest}  [{size / 1e6:.1f} MB, runs {e['path']}]")


if __name__ == "__main__":
    main()
