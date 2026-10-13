"""UCI chess engines for ai-chess: a small process manager plus a one-click installer for popular engines.

Engines live in <data>/engines/. Each installed engine is an entry in engines.json:
  {"id", "name", "path", "args", "catalog", "kind", "options": [...], "variants": [...], "chess960": bool, "weights": {...}}
`kind` decides how strength is controlled: "elo" (UCI_LimitStrength/UCI_Elo), "nodes" (Leela), "maia" (Leela + Maia net,
one node per move), "time" (anything else: time per move only).

GPL-3.0-or-later.
"""
import fnmatch
import json
import os
import platform
import queue
import shutil
import stat
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

UA = {"User-Agent": "ai-chess (https://github.com/BrandScape-Media/ai-chess)"}
NOWINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Popular engines with downloadable builds. Asset patterns are tried in order (fastest build first, safest last);
# a build that does not answer "uci" on this CPU is discarded and the next one is tried.
CATALOG = [
    {"id": "stockfish", "name": "Stockfish", "kind": "elo", "repo": "official-stockfish/Stockfish",
     "about": "The strongest open-source engine. Strength from about 1320 Elo up to full strength.",
     "assets": {"win-x64": ["*windows-x86-64-universal.zip", "*windows-x86-64-avx2.zip", "*windows-x86-64.zip"],
                "win-arm64": ["*windows-arm64*.zip"],
                "linux-x64": ["*linux-x86-64-universal.tar*", "*linux-x86-64-avx2.tar*", "*linux-x86-64.tar*"],
                "linux-arm64": ["*linux-arm64*.tar*"],
                "mac": ["*macos*.tar*"]}},
    {"id": "fairy-stockfish", "name": "Fairy-Stockfish", "kind": "elo", "repo": "fairy-stockfish/Fairy-Stockfish",
     "about": "Stockfish for chess variants: plays King of the Hill and Three-check too.",
     "assets": {"win-x64": ["fairy-stockfish_x86-64-bmi2.exe", "fairy-stockfish_x86-64-modern.exe", "fairy-stockfish_x86-64.exe"],
                "linux-x64": ["fairy-stockfish_x86-64-bmi2", "fairy-stockfish_x86-64-modern", "fairy-stockfish_x86-64"]}},
    {"id": "lc0", "name": "Leela Chess Zero", "kind": "nodes", "repo": "LeelaChessZero/lc0",
     "about": "Neural-network engine in the AlphaZero style (AlphaZero itself was never released). Comes with a small CPU-friendly net.",
     "assets": {"win-x64": ["lc0-*-windows-cpu-openblas.zip", "lc0-*-windows-cpu-dnnl.zip"]},
     "extra": [{"url": "https://storage.lczero.org/files/networks-contrib/t1-256x10-distilled-swa-2432500.pb.gz",
                "file": "t1-256x10-distilled-swa-2432500.pb.gz"}]},
    {"id": "maia", "name": "Maia (human-like)", "kind": "maia", "repo": "CSSLab/maia-chess", "requires": "lc0",
     "about": "Leela nets trained on human games, from 1100 to 1900 rating: plays like a person of that level, mistakes included.",
     "assets": {"*": ["maia-*.pb.gz"]}, "all_assets": True},
    {"id": "berserk", "name": "Berserk", "kind": "time", "repo": "jhonnold/berserk",
     "about": "A top-10 engine with a very aggressive style.",
     "assets": {"win-x64": ["berserk-*-avx2.exe", "berserk-*-sse41.exe", "berserk-*-x86-64.exe"]}},
    {"id": "koivisto", "name": "Koivisto", "kind": "time", "repo": "Luecx/Koivisto",
     "about": "A strong, compact engine.",
     "assets": {"win-x64": ["Koivisto_*-windows-avx2-pgo.exe", "Koivisto_*-windows-sse42-pgo.exe", "Koivisto_*-windows-sse2-pgo.exe"],
                "linux-x64": ["Koivisto_*-linux-avx2-pgo", "Koivisto_*-linux-sse42-pgo", "Koivisto_*-linux-sse2-pgo"]}},
    {"id": "obsidian", "name": "Obsidian", "kind": "time", "repo": "gab8192/Obsidian",
     "about": "One of the strongest engines today. Needs a CPU with AVX2.",
     "assets": {"win-x64": ["Obsidian*-avx2.exe", "Obsidian*-avx2-pext.exe"]}},
    {"id": "caissa", "name": "Caissa", "kind": "time", "repo": "Witek902/Caissa",
     "about": "A top engine named after Caïssa, the goddess of chess.",
     "assets": {"win-x64": ["caissa-*-x64-avx2-bmi2.exe", "caissa-*-x64-avx2.exe", "caissa-*-x64-sse4-popcnt.exe", "caissa-*-x64-sse2.exe"]}},
    {"id": "clover", "name": "Clover", "kind": "time", "repo": "lucametehau/CloverEngine",
     "about": "A strong open-source engine.",
     "assets": {"win-x64": ["Clover.*-avx2.exe", "Clover.*-old.exe"]}},
    {"id": "halogen", "name": "Halogen", "kind": "time", "repo": "KierenP/Halogen",
     "about": "A strong engine with its own neural network.",
     "assets": {"win-x64": ["Halogen-*-windows-x86_64-avx2.exe", "Halogen-*-windows-x86_64-sse4.exe", "Halogen-*-windows-x86_64-legacy.exe"]}},
    # veterans and lesser-known engines
    {"id": "arasan", "name": "Arasan", "kind": "time", "repo": "jdart1/arasan-chess", "group": "veteran",
     "about": "One of the oldest engines still in development: Jon Dart released the first version in 1994. Can play at a set Elo.",
     "assets": {"win-x64": ["arasan*.zip"]},
     "exes": ["arasanx-64-avx2-bmi2.exe", "arasanx-64-avx2.exe", "arasanx-64-modern.exe", "arasanx-64.exe"]},
    {"id": "weiss", "name": "Weiss", "kind": "time", "repo": "TerjeKir/weiss", "group": "veteran",
     "about": "A small, readable engine from 2021 that thinks the old-fashioned way, without a neural network.",
     "assets": {"win-x64": ["Weiss-*-windows-collection.zip"]},
     "exes": ["weiss-popcnt.exe", "weiss-nopopcnt.exe"]},
    {"id": "fabchess", "name": "FabChess", "kind": "time", "repo": "fabianvdW/FabChess", "group": "veteran",
     "about": "A hobby engine written in Rust, last released in 2020. Classic evaluation, no neural network.",
     "assets": {"win-x64": ["FabChess*POPCNTWin64.exe", "FabChess*OLDWin64.exe"]}},
    {"id": "seer", "name": "Seer", "kind": "time", "repo": "connormcmonigle/seer-nnue", "group": "veteran",
     "about": "A lesser-known engine whose network learned backwards, starting from solved endgames.",
     "assets": {"win-x64": ["seer_*_x64_avx2_popcnt.exe", "seer_*_x64_ssse3_nopopcnt.exe"]}},
    {"id": "velvet", "name": "Velvet", "kind": "time", "repo": "mhonert/velvet-chess", "group": "veteran",
     "about": "A quiet hobby engine written in Rust.",
     "assets": {"win-x64": ["velvet-*-x86_64-avx2.exe", "velvet-*-x86_64-sse4-popcnt.exe", "velvet-*-x86_64-nopopcnt.exe"]}},
    {"id": "altair", "name": "Altair", "kind": "time", "repo": "Alex2262/AltairChessEngine", "group": "veteran",
     "about": "A lesser-known hobby engine named after the star.",
     "assets": {"win-x64": ["Altair-windows-x86-64-v3.exe", "Altair-windows-x86-64-v2.exe", "Altair-windows-x86-64-v1.exe"]}},
]
NOT_AVAILABLE = [
    {"name": "Deep Blue", "about": "IBM's 1997 machine ran on custom chips and was never released. Stockfish set to about 2850 Elo plays at its level."},
    {"name": "AlphaZero", "about": "DeepMind never released it. Leela Chess Zero is the open-source reimplementation of the same idea."},
    {"name": "Crafty, Fruit, GNU Chess", "about": "Classics without official GitHub downloads (Crafty also speaks only the older WinBoard protocol). If you have a UCI build, add it with 'Add engine'."},
    {"name": "Komodo Dragon", "about": "Commercial. If you own it, add its .exe with 'Add engine'."},
]


def platform_key():
    s, m = sys.platform, platform.machine().lower()
    arm = m in ("arm64", "aarch64")
    if s == "win32":
        return "win-arm64" if arm else "win-x64"
    if s == "darwin":
        return "mac"
    return "linux-arm64" if arm else "linux-x64"


class EngineProcess:
    """One running UCI engine. All talking happens under self.lock."""

    def __init__(self, path, args=(), cwd=None):
        self.path = path
        self.lock = threading.Lock()
        self.q = queue.Queue()
        self.p = subprocess.Popen([path, *args], cwd=cwd or str(Path(path).parent), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, bufsize=1, creationflags=NOWINDOW,
                                  encoding="utf-8", errors="replace")
        threading.Thread(target=self._read, daemon=True).start()
        self.opts = {}       # option values already sent
        self.info = {}       # from the uci handshake
        self.game = None

    def _read(self):
        for line in self.p.stdout:
            self.q.put(line.rstrip("\r\n"))
        self.q.put(None)

    def alive(self):
        return self.p.poll() is None

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()

    def until(self, prefix, timeout, on_line=None):
        end = time.time() + timeout
        while True:
            left = end - time.time()
            if left <= 0:
                raise TimeoutError(f"engine did not answer '{prefix}' in time")
            try:
                line = self.q.get(timeout=left)
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError("engine quit")
            if on_line:
                on_line(line)
            if line.startswith(prefix):
                return line

    def handshake(self, timeout=20):
        info = {"name": None, "author": None, "options": {}}

        def on(line):
            if line.startswith("id name "):
                info["name"] = line[8:].strip()
            elif line.startswith("id author "):
                info["author"] = line[10:].strip()
            elif line.startswith("option name "):
                rest = line[12:]
                name, _, spec = rest.partition(" type ")
                parts = spec.split()
                opt = {"type": parts[0] if parts else "string"}
                for key in ("default", "min", "max"):
                    if f" {key} " in f" {spec} ":
                        tail = (spec + " ").split(f"{key} ", 1)[1]   # "default" may have an empty value at the end of the line
                        opt[key] = tail.split(" var ")[0].split(" min ")[0].split(" max ")[0].strip()
                if " var " in f" {spec}":
                    opt["vars"] = [v.strip() for v in spec.split(" var ")[1:]]
                info["options"][name.strip()] = opt
        self.send("uci")
        self.until("uciok", timeout, on)
        self.info = info
        return info

    def setoption(self, name, value):
        v = str(value).lower() if isinstance(value, bool) else str(value)
        if self.opts.get(name) != v:
            self.send(f"setoption name {name} value {v}")
            self.opts[name] = v

    def ready(self, timeout=60):
        self.send("isready")
        self.until("readyok", timeout)

    def go(self, position, go, timeout):
        self.send(position)
        last = {}

        def on(line):
            if line.startswith("info ") and " score " in line:
                t = line.split()
                d = {}
                for i, w in enumerate(t):
                    if w in ("depth", "nodes", "nps", "time") and i + 1 < len(t):
                        try:
                            d[w] = int(t[i + 1])
                        except ValueError:
                            pass
                    elif w == "score" and i + 2 < len(t):
                        try:
                            d["cp" if t[i + 1] == "cp" else "mate"] = int(t[i + 2])
                        except ValueError:
                            pass
                    elif w == "pv":
                        d["pv"] = t[i + 1:i + 9]
                        break
                if "multipv" not in t or t[t.index("multipv") + 1] == "1":
                    last.update(d)
        self.send(go)
        line = self.until("bestmove", timeout, on)
        parts = line.split()
        return {"bestmove": parts[1] if len(parts) > 1 else None, "info": last}

    def quit(self):
        try:
            self.send("quit")
            self.p.wait(2)
        except Exception:
            pass
        if self.alive():
            self.p.kill()


class Engines:
    def __init__(self, data_dir):
        self.dir = Path(data_dir) / "engines"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.reg_file = self.dir / "engines.json"
        self.procs = {}
        self.plock = threading.Lock()
        self.jobs = {}   # install progress per catalog id
        try:
            self.reg = json.loads(self.reg_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.reg = []

    # ---------- registry ----------
    def save(self):
        tmp = self.reg_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.reg, indent=1), encoding="utf-8")
        tmp.replace(self.reg_file)

    def abspath(self, p):
        p = Path(p)
        return str(p if p.is_absolute() else self.dir / p)

    def relpath(self, p):
        try:
            return str(Path(p).resolve().relative_to(self.dir.resolve()))
        except ValueError:
            return str(Path(p).resolve())

    def get(self, eid):
        return next((e for e in self.reg if e["id"] == eid), None)

    def listing(self):
        pk = platform_key()
        cat = []
        for c in CATALOG:
            avail = "*" in c["assets"] or pk in c["assets"]
            cat.append({k: c[k] for k in ("id", "name", "about", "kind")} | {"available": avail, "installed": bool(self.get(c["id"])),
                                                                            "requires": c.get("requires"), "group": c.get("group", "top")})
        return {"installed": [{k: e.get(k) for k in ("id", "name", "kind", "variants", "chess960", "elo", "catalog", "weights", "path", "author")}
                              for e in self.reg],
                "catalog": cat, "unavailable": NOT_AVAILABLE, "platform": pk, "jobs": self.jobs}

    def describe(self, info, path):
        opts = info["options"]
        variants = ["chess"]
        if "UCI_Variant" in opts:
            variants = sorted(set(variants + [v for v in opts["UCI_Variant"].get("vars", []) if v in ("chess", "kingofthehill", "3check")]))
        elo = None
        if "UCI_Elo" in opts:
            try:
                elo = [int(opts["UCI_Elo"]["min"]), int(opts["UCI_Elo"]["max"])]
            except (KeyError, ValueError):
                elo = None
        return {"name": info["name"] or Path(path).stem, "author": info.get("author"), "variants": variants,
                "chess960": "UCI_Chess960" in opts, "elo": elo, "options": sorted(opts)}

    def probe(self, path, args=()):
        """Start the engine, do the uci handshake, quit. Returns the description or raises."""
        if not os.path.isfile(path):
            raise FileNotFoundError(f"no such file: {path}")
        e = EngineProcess(path, args)
        try:
            return self.describe(e.handshake(), path)
        finally:
            e.quit()

    def add_custom(self, path, name=None, args=()):
        path = str(Path(path.strip().strip('"')).expanduser())
        d = self.probe(path, args)
        eid = "custom-" + "".join(ch if ch.isalnum() else "-" for ch in (name or d["name"]).lower()).strip("-")[:40]
        while self.get(eid):
            eid += "-2"
        kind = "elo" if d["elo"] else "time"
        if "WeightsFile" in d["options"] and "lc0" in path.lower():
            kind = "nodes"
        entry = {"id": eid, "name": name or d["name"], "path": path, "args": list(args), "catalog": None, "kind": kind} | d
        self.reg.append(entry)
        self.save()
        return entry

    def remove(self, eid):
        e = self.get(eid)
        if not e:
            return False
        self.stop_proc(eid)
        self.reg = [x for x in self.reg if x["id"] != eid]
        self.save()
        if e.get("catalog"):
            shutil.rmtree(self.dir / e["catalog"], ignore_errors=True)
        return True

    # ---------- installer ----------
    def install(self, cid):
        c = next((x for x in CATALOG if x["id"] == cid), None)
        if not c:
            raise ValueError("unknown engine")
        if self.jobs.get(cid, {}).get("state") == "running":
            return
        self.jobs[cid] = {"state": "running", "step": "starting", "done": 0, "total": 0}
        threading.Thread(target=self._install, args=(c,), daemon=True).start()

    def _job(self, cid, **kw):
        self.jobs[cid].update(kw)

    def _download(self, cid, url, dest):
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            self._job(cid, done=0, total=total)
            got = 0
            while True:
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                self._job(cid, done=got)

    def _release(self, repo):
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/latest", headers=UA | {"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    def _install(self, c):
        cid = c["id"]
        try:
            if c.get("requires") and not self.get(c["requires"]):
                self._job(cid, step=f"installing {c['requires']} first")
                self.jobs[c["requires"]] = {"state": "running", "step": "starting", "done": 0, "total": 0}
                self._install(next(x for x in CATALOG if x["id"] == c["requires"]))
                if not self.get(c["requires"]):
                    raise RuntimeError(f"{c['requires']} is needed first and could not be installed")
                self.jobs[cid] = {"state": "running", "step": "", "done": 0, "total": 0}
            self._job(cid, step="looking up the latest release")
            rel = self._release(c["repo"])
            assets = rel.get("assets", [])
            pats = c["assets"].get("*") or c["assets"].get(platform_key())
            if not pats:
                raise RuntimeError(f"no download for this platform ({platform_key()}); download it yourself and use 'Add engine'")
            target = self.dir / cid
            if c.get("all_assets"):   # Maia: every net, played through Leela
                target.mkdir(parents=True, exist_ok=True)
                nets = {}
                for a in assets:
                    if any(fnmatch.fnmatch(a["name"], p) for p in pats):
                        self._job(cid, step=f"downloading {a['name']}")
                        self._download(cid, a["browser_download_url"], target / a["name"])
                        nets[a["name"].split(".")[0].replace("maia-", "")] = a["name"]
                if not nets:
                    raise RuntimeError("no nets found in the release")
                lc0 = self.get("lc0")
                entry = {"id": "maia", "name": "Maia", "path": lc0["path"], "args": [], "catalog": "maia", "kind": "maia",
                         "variants": ["chess"], "chess960": False, "elo": None, "version": rel.get("tag_name"),
                         "weights": {k: str(Path("maia") / v) for k, v in sorted(nets.items())}}
                self._register(entry)
                self._job(cid, state="done", step="installed")
                return
            errors = []
            for pat in pats:
                for a in [x for x in assets if fnmatch.fnmatch(x["name"], pat)]:
                    shutil.rmtree(target, ignore_errors=True)
                    target.mkdir(parents=True)
                    self._job(cid, step=f"downloading {a['name']}")
                    dl = target / a["name"]
                    self._download(cid, a["browser_download_url"], dl)
                    self._job(cid, step="unpacking")
                    exe = self._unpack(dl, target, cid)
                    # archives with one build per CPU type: the fastest build that runs here wins
                    tries = [p for pat in c["exes"] for p in sorted(target.rglob(pat))] if c.get("exes") else [exe]
                    d = None
                    for exe in tries:
                        try:
                            self._job(cid, step="testing the engine")
                            d = self.probe(str(exe))
                            break
                        except Exception as e:   # wrong CPU build: try the next one
                            errors.append(f"{exe.name}: {e}")
                    if d is None:
                        continue
                    for ex in c.get("extra", []):
                        self._job(cid, step=f"downloading {ex['file']}")
                        self._download(cid, ex["url"], target / ex["file"])
                    kind = c["kind"] if c["kind"] not in ("elo", "time") else ("elo" if d["elo"] else "time")
                    entry = {"id": cid, "name": d["name"], "path": self.relpath(exe), "args": [], "catalog": cid, "kind": kind,
                             "version": rel.get("tag_name")} | d
                    if c.get("extra"):
                        entry["weights"] = {"default": str(Path(cid) / c["extra"][0]["file"])}
                    self._register(entry)
                    self._job(cid, state="done", step="installed")
                    return
            raise RuntimeError("no build worked on this machine: " + "; ".join(errors) if errors else "no matching download found")
        except Exception as e:
            self._job(cid, state="error", step=str(e))

    def _register(self, entry):
        self.stop_proc(entry["id"])
        self.reg = [x for x in self.reg if x["id"] != entry["id"]] + [entry]
        self.save()

    def _unpack(self, dl, target, cid):
        name = dl.name.lower()
        if name.endswith(".zip"):
            with zipfile.ZipFile(dl) as z:
                z.extractall(target)
            dl.unlink()
        elif ".tar" in name:
            with tarfile.open(dl) as t:
                t.extractall(target, filter="data") if hasattr(tarfile, "data_filter") else t.extractall(target)
            dl.unlink()
        cands = []
        for p in target.rglob("*"):
            if not p.is_file():
                continue
            n = p.name.lower()
            if sys.platform == "win32":
                if n.endswith(".exe"):
                    cands.append(p)
            elif "." not in n or n.endswith((".bin", "-universal")) or os.access(p, os.X_OK):
                cands.append(p)
        if not cands:
            raise RuntimeError("no engine executable in the download")
        key = cid.split("-")[0]
        cands.sort(key=lambda p: (key not in p.name.lower(), "test" in p.name.lower(), -p.stat().st_size))
        exe = cands[0]
        if sys.platform != "win32":
            exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return exe

    # ---------- playing ----------
    def stop_proc(self, prefix):
        with self.plock:
            for k in [k for k in self.procs if k == prefix or k.startswith(prefix + "|")]:
                self.procs.pop(k).quit()

    def proc(self, e, weights):
        key = e["id"] + ("|" + weights if weights else "")
        with self.plock:
            p = self.procs.get(key)
            if p and p.alive():
                return p
            path = self.abspath(e["path"])
            p = EngineProcess(path, e.get("args", []))
            p.handshake()
            if weights:
                p.setoption("WeightsFile", self.abspath(weights))
            self.procs[key] = p
            return p

    def go(self, req):
        e = self.get(req["engine"])
        if not e:
            raise ValueError("engine not installed")
        weights = None
        if e["kind"] == "maia":
            w = e.get("weights", {})
            weights = w.get(str(req.get("maia", "1500"))) or next(iter(w.values()))
        elif e.get("weights"):
            weights = e["weights"].get("default")
        variant = req.get("variant", "chess")
        if variant not in e.get("variants", ["chess"]):
            raise ValueError(f"{e['name']} does not play {variant}")
        for attempt in range(2):
            p = self.proc(e, weights)
            try:
                with p.lock:
                    opts = p.info.get("options", {})
                    if "UCI_Variant" in opts:
                        p.setoption("UCI_Variant", variant)
                    if "UCI_Chess960" in opts:
                        p.setoption("UCI_Chess960", bool(req.get("chess960")))
                    if "Threads" in opts and e["kind"] in ("elo", "time"):
                        p.setoption("Threads", req.get("threads") or max(1, min(4, (os.cpu_count() or 2) // 2)))
                    if "Hash" in opts and e["kind"] in ("elo", "time"):
                        p.setoption("Hash", 128)
                    elo = req.get("elo")
                    if "UCI_LimitStrength" in opts:
                        p.setoption("UCI_LimitStrength", bool(elo))
                        if elo and "UCI_Elo" in opts:
                            lo, hi = int(opts["UCI_Elo"].get("min", 0)), int(opts["UCI_Elo"].get("max", 4000))
                            p.setoption("UCI_Elo", max(lo, min(hi, int(elo))))
                    if req.get("game") != p.game:
                        p.send("ucinewgame")
                        p.game = req.get("game")
                    p.ready()
                    if req.get("fen_now"):
                        pos = f"position fen {req['fen_now']}"
                    else:
                        pos = f"position fen {req['fen']}" + (" moves " + " ".join(req["moves"]) if req.get("moves") else "")
                    clock = req.get("clock") or None
                    clk = ""
                    if clock:   # real clocks: the engine decides how long to think
                        c = {k: max(0, int(clock.get(k) or 0)) for k in ("wtime", "btime", "winc", "binc")}
                        clk = f" wtime {max(1, c['wtime'])} btime {max(1, c['btime'])} winc {c['winc']} binc {c['binc']}"
                    depth = int(req.get("depth") or 0)
                    if e["kind"] == "maia":
                        go, tmo = "go nodes 1", 60
                    elif req.get("nodes"):
                        go, tmo = f"go nodes {int(req['nodes'])}" + clk, 300
                    elif clk:
                        go = "go" + (f" depth {depth}" if depth else "") + clk
                        tmo = max(c["wtime"], c["btime"]) / 1000 + 30
                    elif depth:   # depth limit, capped so a deep search can't hang the game
                        go, tmo = f"go depth {depth} movetime 20000", 50
                    else:
                        ms = int(req.get("movetime") or 1000)
                        go, tmo = f"go movetime {ms}", ms / 1000 + 30
                    return p.go(pos, go, tmo)
            except (RuntimeError, BrokenPipeError, OSError, TimeoutError):
                self.stop_proc(e["id"])
                if attempt:
                    raise
        raise RuntimeError("engine failed")

    def shutdown(self):
        with self.plock:
            for p in self.procs.values():
                p.quit()
            self.procs.clear()
