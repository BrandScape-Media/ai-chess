"""Tests for puzzledb.py and the /api/puzzles routes.

A small lichess-format puzzle file (the real puzzles in web/puzzles/puzzles.json plus copies with other ratings and themes)
is served from a local HTTP server that supports Range, installed end to end (with dropped connections, a file that changed
upstream, a cut-off file, a cancel), picked from, removed, and finally used once through a real server.py over HTTP.

    python tests/test_puzzledb.py

Making the test file needs a zstd compressor (Python 3.14+ or pip install zstandard); without one the test says so and passes.
"""
import csv
import hashlib
import io
import json
import os
import random
import re
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.pop("AICHESS_PUZZLE_URL", None)
os.environ["no_proxy"] = os.environ["NO_PROXY"] = "127.0.0.1,localhost," + os.environ.get("no_proxy", "")

fail = 0


def check(name, ok, detail=""):
    global fail
    if not ok:
        fail += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))


def compressor():
    """A zstd compressor writing checksums, like the zstd tool that makes the real file."""
    try:
        from compression import zstd
        return lambda b: zstd.compress(b, options={zstd.CompressionParameter.checksum_flag: 1})
    except ImportError:
        pass
    try:
        import zstandard
        return lambda b: zstandard.ZstdCompressor(write_checksum=True).compress(b)
    except ImportError:
        return None


# ---------------------------------------------------------------- test data
HEADER = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags".split(",")


def make_csv(seed, extra=1500):
    """Rows as written, and the valid ones as {id: (fen, moves, rating, themes)}."""
    rnd = random.Random(seed)
    src = json.loads((ROOT / "web" / "puzzles" / "puzzles.json").read_text(encoding="utf-8"))
    good = [[p["id"], p["fen"], p["moves"], p["r"], p["t"]] for p in src]
    for k in range(extra):
        p = rnd.choice(src)
        th = set(p["t"].split())
        if k % 40 == 0:
            th.add("triangleMate")          # a theme whose bit is in the second mask
        elif k % 97 == 1:
            th.add("testOnlyMate")          # a theme the code has never heard of: it gets the next free bit
        if k % 250 == 3:
            th.add("Bad-Name!")             # not a theme name: ignored, the puzzle stays
        good.append([f"x{seed}{k:04d}", p["fen"], p["moves"], max(400, min(3000, int(rnd.gauss(1500, 450)))), " ".join(sorted(th))])
    rnd.shuffle(good)
    rows = []
    for pid, fen, moves, r, t in good:
        opening = rnd.choice(["", "Sicilian_Defense Sicilian_Defense_Najdorf_Variation", "Italian_Game, quoted"])
        rows.append([pid, fen, moves, r, rnd.randint(74, 110), rnd.randint(-20, 100), rnd.randint(100, 9000), t,
                     f"https://lichess.org/{pid}#{rnd.randint(10, 90)}", opening])
    fen, moves = src[0]["fen"], src[0]["moves"]
    bad = [["bad1", fen, moves, "abc", 80, 90, 100, "fork", "", ""], ["bad2", fen, "e2e4", 1500, 80, 90, 100, "fork", "", ""],
           ["bad3", fen], ["", fen, moves, 1500, 80, 90, 100, "fork", "", ""]]
    for i, b in enumerate(bad):
        rows.insert(500 + i * 700, b)
    valid = {pid: (fen, moves, r, " ".join(sorted(x for x in t.split() if x.isalnum()))) for pid, fen, moves, r, t in good}
    return rows, valid


def to_zst(rows, zc):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    w.writerows(rows)
    raw = buf.getvalue().encode()
    cut = len(raw) // 2 + 7   # two frames, split mid-line, like a file written in parts
    return zc(raw[:cut]) + zc(raw[cut:]), len(raw)


# ---------------------------------------------------------------- a file server with Range and If-Range, like nginx
FILES, LOG, CTL = {}, [], {"drop": 0, "cut": 0.1, "slow": 0.0}   # cut: share of the file sent before a drop


class Files(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = FILES.get(self.path)
        if body is None:
            return self.send_error(404)
        etag = '"' + hashlib.sha1(body).hexdigest()[:16] + '"'
        start, code = 0, 200
        m = re.match(r"bytes=(\d+)-$", self.headers.get("Range", ""))
        if m and self.headers.get("If-Range") == etag:
            start, code = int(m.group(1)), 206
        LOG.append((self.path, self.headers.get("Range"), self.headers.get("If-Range"), code))
        self.send_response(code)
        self.send_header("Content-Length", str(len(body) - start))
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", "Tue, 13 Oct 2026 10:00:00 GMT")
        self.send_header("Accept-Ranges", "bytes")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
        self.end_headers()
        data = body[start:]
        if CTL["drop"] > 0:   # the connection breaks part way through
            CTL["drop"] -= 1
            data = data[:int(len(body) * CTL["cut"])]
        try:
            for i in range(0, len(data), 16384):
                self.wfile.write(data[i:i + 16384])
                if CTL["slow"]:
                    time.sleep(CTL["slow"])
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


def wait(db, timeout=60):
    t = time.time()
    while db.busy() and time.time() - t < timeout:
        time.sleep(0.02)
    return db.status()


def files(d):
    p = Path(d) / "puzzles"
    return sorted(f.name for f in p.iterdir()) if p.exists() else []


def traced(db, fn):
    """fn's result, and the SQL it ran."""
    calls = []
    db.db.set_trace_callback(calls.append)
    try:
        return fn(), calls
    finally:
        db.db.set_trace_callback(None)


# ---------------------------------------------------------------- tests
def test_module(base, zc, tmp):
    import puzzledb
    from puzzledb import PuzzleDB
    PuzzleDB.RETRY_WAIT = 0
    rows, valid = make_csv(1)
    FILES["/p.zst"], raw_size = to_zst(rows, zc)
    url = base + "/p.zst"
    tot = len(FILES["/p.zst"])

    # ---- a fresh install, with one dropped connection on the way
    d = Path(tmp, "a")
    (d / "puzzles").mkdir(parents=True)
    (d / "puzzles" / "lichess.sqlite.tmp").write_bytes(b"left over")
    (d / "puzzles" / "install.lock").write_bytes(b"")   # a crash leaves the file, but never the lock
    db = PuzzleDB(d, url=url)
    check("stale .tmp and lock file removed on start", files(d) == [], files(d))
    s = db.status()
    check("status before install", (s["installed"], s["rows"], s["range"], s["themes"], s["job"]) == (False, 0, None, [], None), s)
    check("status: zstd decoder, free and need", s["zstd"] in ("stdlib", "zstandard") and s["free"] > 0 and s["need"] > 0, s)
    try:
        db.pick(1500)
        check("pick before install is refused", False)
    except RuntimeError as e:
        check("pick before install is refused", str(e) == "not installed", e)
    LOG.clear()
    CTL["drop"] = 1
    t0 = time.time()
    db.install()
    check("install starts a job", db.status()["job"]["state"] in ("running", "done"))
    s = wait(db)
    took = time.time() - t0
    check("install finishes", s["job"] and s["job"]["state"] == "done" and s["installed"], s["job"])
    check("the dropped download resumed with Range (206)", [x[3] for x in LOG] == [200, 206] and LOG[1][1] and LOG[1][2], LOG)
    check("download files cleaned up", files(d) == ["lichess.sqlite"], files(d))
    print(f"     install of {len(valid)} puzzles ({tot / 1e3:.0f} kB download, {raw_size / 1e3:.0f} kB of CSV): {took:.2f} s, "
          f"database {s['size'] / 1e6:.2f} MB")

    # ---- status
    counts = {}
    for _, _, _, t in valid.values():
        for x in t.split():
            counts[x] = counts.get(x, 0) + 1
    rs = [v[2] for v in valid.values()]
    check("status: rows (broken rows skipped)", s["rows"] == len(valid), (s["rows"], len(valid)))
    check("status: rating range", s["range"] == [min(rs), max(rs)], s["range"])
    check("status: size", s["size"] == os.path.getsize(d / "puzzles" / "lichess.sqlite"))
    check("status: built time", bool(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", s["built"] or "")), s["built"])
    check("status: need is 0 once installed", s["need"] == 0)
    check("status: themes and counts", {t["name"]: t["n"] for t in s["themes"]} == counts,
          set(t["name"] for t in s["themes"]) ^ set(counts))
    check("status: a new theme got a bit", "testOnlyMate" in counts and any(t["name"] == "testOnlyMate" for t in s["themes"]))
    check("second-mask theme is past bit 62", puzzledb.SEED.index("triangleMate") >= 63)
    job = db.job
    db.install()
    check("install again is a no-op", db.job is job and not db.busy())

    # ---- pick
    ok_win, ok_shape = True, True
    for _ in range(300):
        (p,) = db.pick(1500, window=50)
        ok_win &= 1450 <= p["r"] <= 1550
        v = valid.get(p["id"])
        ok_shape &= set(p) == {"id", "fen", "moves", "r", "t"} and v == (p["fen"], p["moves"], p["r"], p["t"])
    check("pick: ratings stay in the window", ok_win)
    check("pick: shape and content match the file", ok_shape)
    ps = db.pick(1500, count=10)
    check("pick: count 10 gives 10 different puzzles", len({p["id"] for p in ps}) == 10, ps)
    check("pick: count 10 within the default window", all(1400 <= p["r"] <= 1600 for p in ps), [p["r"] for p in ps])
    check("pick: count is capped at 10", len(db.pick(1500, count=50)) == 10)
    check("pick: count 0 gives 1", len(db.pick(1500, count=0)) == 1)
    check("pick: numbers as strings and floats", len(db.pick("1500.6", window="80", count="3")) == 3)
    for th in (["fork"], ["mate", "mateIn2"], ["triangleMate"], ["testOnlyMate"], "fork endgame"):
        want = th.split() if isinstance(th, str) else th
        got = [p for _ in range(40) for p in db.pick(random.randint(600, 2600), themes=th, count=2)]
        check(f"pick: themes {want} on every puzzle", got and all(set(want) <= set(p["t"].split()) for p in got), got[:2])
    pool = {i for i, v in valid.items() if "fork" in v[3].split() and 1400 <= v[2] <= 1600}
    db.rnd = random.Random(5)
    got = {p["id"] for _ in range(400) for p in db.pick(1500, themes=["fork"])}
    check("pick: theme picks spread over every match", got <= pool and len(got) >= 0.9 * len(pool), (len(got), len(pool)))
    absent = [t for t in puzzledb.SEED if t not in counts]
    check("pick: a known theme no puzzle has: empty list", absent and db.pick(1500, themes=absent[:1]) == [], absent)
    check("pick: no puzzle has both: empty list", db.pick(1500, themes=["triangleMate", "testOnlyMate"]) == [])
    check("pick: that miss is remembered", len(db.misses) == 1, db.misses)
    got, calls = traced(db, lambda: db.pick(1500, themes=["testOnlyMate", "triangleMate"]))
    check("pick: a remembered miss reads nothing", got == [] and calls == [], (got, calls))
    p = db.pick(5000)
    check("pick: far outside the range widens the window", len(p) == 1 and p[0]["r"] > 2500, p)
    for bad in (["notATheme"], ["fork", "Bad-Name!"]):
        try:
            db.pick(1500, themes=bad)
            check(f"pick: unknown theme {bad} refused", False)
        except ValueError as e:
            check(f"pick: unknown theme {bad} refused", "unknown theme" in str(e), e)
    for bad in ("abc", None, float("inf")):
        try:
            db.pick(bad)
            check(f"pick: rating {bad!r} refused", False)
        except ValueError:
            check(f"pick: rating {bad!r} refused", True)
    rare = sorted(i for i, v in valid.items() if "testOnlyMate" in v[3].split())
    got = db.pick(1500, themes=["testOnlyMate"], exclude=rare[1:], count=5)
    check("pick: exclude leaves the only unseen puzzle", [p["id"] for p in got] == [rare[0]], (got, len(rare)))
    # a scan reads on past seen matches: the last unseen one always turns up, even behind many seen ones
    top = max(rare, key=lambda i: valid[i][2])
    got = [db.pick(400, themes=["testOnlyMate"], exclude=[i for i in rare if i != top]) for _ in range(200)]
    check("pick: the only unseen match always turns up", all([p["id"] for p in g] == [top] for g in got),
          sum(not g for g in got))
    got = [len(db.pick(r, themes=["testOnlyMate"], exclude=rare[:-10], count=10)) for r in range(400, 3000, 13)]
    check("pick: exactly 10 unseen matches, count 10: all of them, every time", got.count(10) == len(got), sorted(set(got)))
    got, calls = traced(db, lambda: db.pick(1500, themes=["testOnlyMate"], exclude=rare, count=10))
    check("pick: every match seen: empty, read once", got == [] and len(calls) <= 3, (got, len(calls)))
    check("pick: every match seen is not a miss", len(db.misses) == 1, db.misses)
    near = [i for i, v in valid.items() if 1450 <= v[2] <= 1550][:600]
    ok = all(p["id"] not in near for _ in range(100) for p in db.pick(1500, window=50, exclude=near, count=3))
    check("pick: excluded ids never come back", ok)

    # ---- how long a pick takes
    for name, th in (("no theme", None), ("fork", ["fork"]), ("triangleMate", ["triangleMate"])):
        ts = []
        for k in range(2000):
            t0 = time.perf_counter()
            db.pick(600 + k % 2000, themes=th)
            ts.append((time.perf_counter() - t0) * 1000)
        ts.sort()
        print(f"     pick ({name}): median {statistics.median(ts):.3f} ms, p95 {ts[1900]:.3f} ms")

    # ---- remove
    db.remove()
    s = db.status()
    check("remove: not installed, no files", not s["installed"] and s["job"] is None and files(d) == [], (s, files(d)))
    try:
        db.pick(1500)
        check("remove: pick refused after", False)
    except RuntimeError:
        check("remove: pick refused after", True)

    # ---- the download breaks every time: error, then a later install resumes
    d = Path(tmp, "b")
    db = PuzzleDB(d, url=url)
    LOG.clear()
    CTL["drop"] = PuzzleDB.TRIES
    db.install()
    s = wait(db)
    part = d / "puzzles" / "lichess_db_puzzle.csv.zst.part"
    check("broken download: error state", s["job"]["state"] == "error" and "download failed" in s["job"]["step"], s["job"])
    check("broken download: tried TRIES times", len(LOG) == PuzzleDB.TRIES, LOG)
    check("broken download: part kept", 0 < os.path.getsize(part) < tot, files(d))
    check("broken download: need counts what is here", s["need"] == puzzledb.NEED - os.path.getsize(part), s["need"])
    LOG.clear()
    db.install()
    s = wait(db)
    check("resume in a later install", s["installed"] and LOG[0][3] == 206 and LOG[0][1], (s["job"], LOG))
    check("resumed database is whole", s["rows"] == len(valid), s["rows"])

    # ---- the file changed upstream between the two tries: download all of it again, never glue two versions
    d = Path(tmp, "c")
    db = PuzzleDB(d, url=url)
    CTL["drop"] = PuzzleDB.TRIES
    db.install()
    wait(db)
    rows2, valid2 = make_csv(2, extra=600)
    FILES["/p.zst"], _ = to_zst(rows2, zc)
    LOG.clear()
    db.install()
    s = wait(db)
    check("changed upstream: If-Range answered with the whole file", LOG and LOG[0][1] and LOG[0][3] == 200, LOG)
    check("changed upstream: database has the new file", s["installed"] and s["rows"] == len(valid2), (s["job"], s["rows"]))

    # ---- a cut-off file, a file that is not puzzles, a missing file
    FILES["/cut.zst"] = FILES["/p.zst"][:int(len(FILES["/p.zst"]) * 0.6)]
    FILES["/junk.zst"] = zc(b"hello,world\n1,2\n")
    for name, path, want in (("cut-off file", "/cut.zst", "damaged"), ("not a puzzle file", "/junk.zst", "not the lichess"),
                             ("missing file", "/nothing.zst", "404")):
        d = Path(tmp, name.replace(" ", "-"))
        db = PuzzleDB(d, url=base + path)
        db.install()
        s = wait(db)
        check(f"{name}: error state", s["job"]["state"] == "error" and want in s["job"]["step"] and not s["installed"], s["job"])
        check(f"{name}: nothing left behind", files(d) == [], files(d))

    # ---- disk space, no decoder
    d = Path(tmp, "e")
    db = PuzzleDB(d, url=url)
    need = puzzledb.NEED
    puzzledb.NEED = 1 << 60
    db.install()
    s = wait(db)
    puzzledb.NEED = need
    check("not enough disk space: error", s["job"]["state"] == "error" and "disk space" in s["job"]["step"], s["job"])
    zs = puzzledb.ZSTD
    puzzledb.ZSTD = None
    db.install()
    s = wait(db)
    puzzledb.ZSTD = zs
    check("no zstd decoder: error that says what to do", s["job"]["state"] == "error" and "zstandard" in s["job"]["step"], s["job"])

    # ---- remove while downloading cancels the job
    CTL["slow"] = 0.05
    db.install()
    t0 = time.time()
    while not (db.job and db.job["step"] == "downloading" and db.job["done"] > 0) and time.time() - t0 < 20:
        time.sleep(0.01)
    db.remove()
    CTL["slow"] = 0
    time.sleep(0.2)
    s = db.status()
    check("remove cancels a download", s["job"] is None and not db.busy() and files(d) == [], (s["job"], files(d)))

    # ---- two copies of the program on one data folder (each takes the next free port)
    d = Path(tmp, "g")
    a, b = PuzzleDB(d, url=url), PuzzleDB(d, url=url)   # b is already running when a installs
    CTL["slow"] = 0.1
    a.install()
    t0 = time.time()
    while not (a.job and a.job["step"] == "downloading" and a.job["done"] > 0) and time.time() - t0 < 20:
        time.sleep(0.01)
    (d / "puzzles" / "lichess.sqlite.tmp").write_bytes(b"a's build")   # stands in for a build in progress
    c = PuzzleDB(d, url=url)   # a third copy starts now
    check("two copies: one starting up leaves the other's files alone", "lichess.sqlite.tmp" in files(d), files(d))
    b.install()
    s = wait(b)
    check("two copies: install in the other one says why not", s["job"]["state"] == "error" and s["job"]["step"] == puzzledb.BUSY,
          s["job"])
    try:
        b.remove()
        check("two copies: remove in the other one is refused", False)
    except RuntimeError as e:
        check("two copies: remove in the other one is refused", str(e) == puzzledb.BUSY, e)
    check("two copies: the first one's download goes on", a.busy() and a.job["step"] == "downloading", a.job)
    CTL["slow"] = 0
    s = wait(a)
    check("two copies: the first one finishes", s["installed"] and files(d) == ["lichess.sqlite"], (s["job"], files(d)))
    LOG.clear()
    s = b.status()
    check("two copies: the other one sees the database", s["installed"] and s["job"] is None and s["rows"] == len(valid2), s)
    b.install()
    check("two copies: and doesn't download it again", not b.busy() and LOG == [], LOG)
    check("two copies: a third one picks from it", len(c.pick(1500, count=3)) == 3)
    if os.name != "nt":   # Windows refuses to delete a file another copy has open
        a.remove()
        s = b.status()
        check("two copies: the other one sees a remove and lets go of the file", not s["installed"] and b.db is None, s)
        a.install()
        sa = wait(a)
        s = c.status()
        check("two copies: and sees a new build", s["installed"] and s["built"] == sa["built"] and c.db is not None, (s, sa))

    # ---- a damaged database file: reported, and a new install replaces it
    d = Path(tmp, "f")
    (d / "puzzles").mkdir(parents=True)
    (d / "puzzles" / "lichess.sqlite").write_bytes(b"not a database" * 100)
    db = PuzzleDB(d, url=url)
    s = db.status()
    check("damaged database: reported", not s["installed"] and s["job"]["state"] == "error" and "opened" in s["job"]["step"], s)
    db.install()
    s = wait(db)
    check("damaged database: install replaces it", s["installed"] and s["rows"] == len(valid2), s["job"])
    return valid2


def test_server(base, tmp, valid):
    """The routes through a real server.py."""
    port = free_port()
    data = Path(tmp, "server-data")
    env = dict(os.environ, AICHESS_PUZZLE_URL=base + "/p.zst")
    err = open(Path(tmp, "server-stderr.txt"), "w+")
    p = subprocess.Popen([sys.executable, str(ROOT / "server.py"), "--port", str(port), "--no-browser", "--tab", "--no-stockfish",
                          "--data", str(data)], env=env, stdout=subprocess.DEVNULL, stderr=err)

    def call(path, body=None, ctype="application/json"):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    try:
        t0 = time.time()
        while True:
            try:
                call("/api/health")
                break
            except OSError:
                if time.time() - t0 > 20 or p.poll() is not None:
                    raise SystemExit("server.py did not start")
                time.sleep(0.2)
        code, s = call("/api/puzzles")
        keys = {"installed", "rows", "size", "built", "range", "themes", "job", "zstd", "free", "need"}
        check("GET /api/puzzles: every field", code == 200 and keys <= set(s) and not s["installed"] and s["zstd"], s)
        code, r = call("/api/puzzles/pick", {"rating": 1500})
        check("pick before install: 400 not installed", (code, r) == (400, {"error": "not installed"}), (code, r))
        code, s = call("/api/puzzles/install", {})
        check("POST install: running", code == 200 and s["job"] and s["job"]["state"] in ("running", "done"), s)
        while s["job"]["state"] == "running" and time.time() - t0 < 60:
            time.sleep(0.1)
            code, s = call("/api/puzzles")
        check("install through the server", s["installed"] and s["job"]["state"] == "done" and s["rows"] == len(valid), s["job"])
        code, r = call("/api/puzzles/pick", {"rating": 1500, "themes": ["fork"], "count": 5, "exclude": list(valid)[:600]})
        ok = code == 200 and len(r["puzzles"]) == 5 and all("fork" in x["t"].split() and set(x) == {"id", "fen", "moves", "r", "t"}
                                                            for x in r["puzzles"])
        check("POST pick: 5 fork puzzles", ok, r)
        check("POST pick: excluded ids stay out", not {x["id"] for x in r.get("puzzles", [])} & set(list(valid)[:600]))
        code, r = call("/api/puzzles/pick", {"rating": 1500, "themes": ["nope"]})
        check("POST pick: unknown theme is 400", code == 400 and "unknown theme" in r["error"], (code, r))
        code, r = call("/api/puzzles/pick", {"rating": "x"})
        check("POST pick: bad rating is 400", code == 400, (code, r))
        code, r = call("/api/puzzles/pick", {"rating": 1500, "themes": 5})
        check("POST pick: themes not a list is 400", code == 400, (code, r))
        code, r = call("/api/puzzles/pick", {"rating": 1500}, ctype="text/plain")
        check("POST pick: needs JSON content type", code == 403, code)
        code, r = call("/api/puzzles/pick", {"rating": 9000, "themes": ["fork", "pin"]})
        ok = code == 200 and len(r["puzzles"]) >= 1 and all({"fork", "pin"} <= set(x["t"].split()) for x in r["puzzles"])
        check("POST pick: nothing near still finds some", ok, r)

        # history: chat saved with a game, on its own or with the review
        call("/api/history", {"add": {"id": "g1", "result": "1-0"}})
        chat = [{"who": "ai", "text": f"line {i}"} for i in range(70)]
        code, r = call("/api/history", {"update": {"id": "g1", "chat": chat}})
        g = r["games"][-1]
        check("history: chat saved, last 60 lines", len(g["chat"]) == 60 and g["chat"][-1]["text"] == "line 69" and "review" not in g, g)
        code, r = call("/api/history", {"update": {"id": "g1", "review": {"acc": 90}}})
        g = r["games"][-1]
        check("history: review saved, chat kept", g["review"] == {"acc": 90} and len(g["chat"]) == 60, g)
        code, r = call("/api/history", {"update": {"id": "g1", "review": {"acc": 91}, "chat": chat[:2]}})
        g = r["games"][-1]
        check("history: both at once", g["review"] == {"acc": 91} and len(g["chat"]) == 2, g)
        code, r = call("/api/history", {"update": {"id": "g1", "chat": "not a list"}})
        check("history: chat that is not a list is ignored", len(r["games"][-1]["chat"]) == 2)
        saved = json.loads((data / "history.json").read_text(encoding="utf-8"))
        check("history: chat on disk", len(saved[-1]["chat"]) == 2)

        code, s = call("/api/puzzles/remove", {})
        check("POST remove", code == 200 and not s["installed"] and s["job"] is None, s)
        check("remove leaves no files", files(data) == [], files(data))
    finally:
        p.terminate()
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
        err.seek(0)
        out = err.read().strip()
        check("server.py wrote no errors", not out, out[-2000:])
        err.close()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    zc = compressor()
    import puzzledb
    if not zc or not puzzledb.ZSTD:
        print("skipped: making and reading .zst files needs Python 3.14+ or the zstandard package (pip install zstandard)")
        return
    print(f"python {sys.version.split()[0]}, zstd from {puzzledb.ZSTD}")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Files)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        valid = test_module(base, zc, tmp)
        test_server(base, tmp, valid)
    srv.shutdown()
    print("all passed" if not fail else f"{fail} failed")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
