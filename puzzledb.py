"""Optional offline copy of the lichess puzzle database (about 5 million puzzles, CC0, https://database.lichess.org/#puzzles).

Downloaded on request into <data>/puzzles/ and turned into one SQLite file, lichess.sqlite:
  puzzles (k, id, fen, moves, rating, popularity, themes, themes2)    k = rating << 20 | n-th puzzle of that rating
  ratings (rating, n)    themes (name, bit, n)    meta (k, v)
Rows sit grouped by rating with no index, so a random puzzle near a rating is one primary-key lookup, and a theme filter
is a short scan from a random puzzle that tests two bit masks (bits 0..62 in themes, 63..125 in themes2). A theme's bit is
read from the themes table, never from code, so a database built by an older or newer version still works.

Unpacking the .zst needs Python 3.14+ (compression.zstd) or the zstandard package; the release build ships zstandard.
GPL-3.0-or-later.
"""
import bisect
import csv
import errno
import http.client
import io
import itertools
import json
import os
import random
import re
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from uci import UA

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
SCHEMA = 1
NEED = 1_100_000_000   # the download (about 0.3 GB) and the database (about 0.65 GB) are both on disk when the build ends
MAX_BITS = 126         # two 63-bit masks: SQLite integers are signed 64-bit
# theme bits never move: this list is only ever appended to, and a theme it doesn't know gets the next free bit
SEED = ("mate mateIn1 mateIn2 mateIn3 mateIn4 mateIn5 oneMove short long veryLong opening middlegame endgame "
        "advantage crushing equality fork pin skewer discoveredAttack discoveredCheck doubleCheck hangingPiece sacrifice "
        "deflection attraction clearance interference intermezzo capturingDefender xRayAttack zugzwang quietMove defensiveMove "
        "trappedPiece exposedKing kingsideAttack queensideAttack attackingF2F7 advancedPawn promotion underPromotion enPassant "
        "castling backRankMate smotheredMate anastasiaMate arabianMate bodenMate doubleBishopMate dovetailMate hookMate "
        "pawnEndgame rookEndgame bishopEndgame knightEndgame queenEndgame queenRookEndgame master masterVsMaster superGM "
        "balestraMate blindSwineMate collinearMove cornerMate epauletteMate killBoxMate morphysMate operaMate "
        "pillsburysMate swallowstailMate triangleMate vukovicMate").split()
TABLES = """
CREATE TABLE puzzles (k INTEGER PRIMARY KEY, id TEXT NOT NULL, fen TEXT NOT NULL, moves TEXT NOT NULL,
                      rating INTEGER NOT NULL, popularity INTEGER NOT NULL, themes INTEGER NOT NULL, themes2 INTEGER NOT NULL);
CREATE TABLE ratings (rating INTEGER PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE themes (name TEXT PRIMARY KEY, bit INTEGER NOT NULL, n INTEGER NOT NULL);
CREATE TABLE meta (k TEXT PRIMARY KEY, v);
"""
HEADER = "PuzzleId FEN Moves Rating RatingDeviation Popularity NbPlays Themes GameUrl OpeningTags".split()
FIELDS = ("PuzzleId", "FEN", "Moves", "Rating", "Themes", "Popularity")   # the columns kept (GameUrl alone would be 200 MB)
COLS = "id, fen, moves, rating, themes, themes2"
SCAN = f"SELECT {COLS} FROM puzzles WHERE k BETWEEN ? AND ? AND themes & ? = ? AND themes2 & ? = ? LIMIT 4"


# ---------------------------------------------------------------- zstd
def zstd_backend():
    """(name, new decompressor, error class): the standard library's (Python 3.14+), else the zstandard package's."""
    try:
        from compression import zstd
        return "stdlib", zstd.ZstdDecompressor, zstd.ZstdError
    except ImportError:
        pass
    try:
        import zstandard
        return "zstandard", lambda: zstandard.ZstdDecompressor().decompressobj(), zstandard.ZstdError
    except ImportError:
        return None, None, None


ZSTD, new_decoder, ZstdError = zstd_backend()
BAD_DATA = (EOFError, csv.Error, UnicodeDecodeError) + ((ZstdError,) if ZstdError else ())


def unzstd(f, on_read, size=1 << 20):
    """The decompressed bytes of a .zst file, chunk by chunk, frame after frame. A file cut off mid-frame raises EOFError:
    zstandard's own stream_reader quietly stops there, which would build half a database that looks fine."""
    d, mid = new_decoder(), False
    while b := f.read(size):
        on_read(len(b))
        while b:
            mid = True
            out = d.decompress(b)
            if out:
                yield out
            if d.eof:   # end of a frame: what is left over starts the next one
                b, d, mid = d.unused_data, new_decoder(), False
            else:
                b = b""
    if mid:
        raise EOFError("the file stops in the middle")


class ChunkReader(io.RawIOBase):
    """A file object over an iterator of byte chunks, so io.TextIOWrapper and csv.reader can sit on top."""

    def __init__(self, chunks):
        self.chunks, self.buf = chunks, memoryview(b"")

    def readable(self):
        return True

    def readinto(self, m):
        while not self.buf:
            nxt = next(self.chunks, None)
            if nxt is None:
                return 0
            self.buf = memoryview(nxt)
        n = min(len(m), len(self.buf))
        m[:n] = self.buf[:n]
        self.buf = self.buf[n:]
        return n


# ---------------------------------------------------------------- helpers
class Cancelled(Exception):
    pass


class Failed(Exception):
    """An install error whose message is meant for the page."""


class BadFile(Failed):
    """The download is not a whole lichess puzzle file: it is deleted, so the next try downloads it again."""


def size(p):
    try:
        return p.stat().st_size
    except OSError:
        return 0


def load(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def drop(*paths):
    for p in paths:
        try:
            p.unlink()
        except FileNotFoundError:
            pass


def num(x, default):
    """A whole number from the page (JSON may send 1500.4 or "1500"); junk is a ValueError, which the server answers with 400."""
    if x is None or x == "":
        return default
    try:
        return int(round(float(x)))
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"not a number: {str(x)[:20]}") from None


def explain(e):
    """A short, readable reason for an install error."""
    if isinstance(e, Failed):
        return str(e)
    if isinstance(e, urllib.error.HTTPError):
        return f"download failed: the server answered {e.code} {e.reason}"
    if isinstance(e, urllib.error.URLError):
        return f"download failed: {e.reason}"
    if isinstance(e, TimeoutError):
        return "download failed: the connection timed out. Try again to resume"
    if isinstance(e, http.client.HTTPException):
        return "download failed: the connection was lost. Try again to resume"
    if isinstance(e, ConnectionError):
        return f"download failed: {e.strerror or e}. Try again to resume"
    if getattr(e, "errno", None) == errno.ENOSPC or "disk is full" in str(e):
        return "not enough disk space"
    if isinstance(e, sqlite3.Error):
        return f"building the puzzle database failed: {e}"
    return str(e) or type(e).__name__


def theme_mask(names, bits, counts):
    """The two bit masks of a Themes field; new themes get the next free bit, and every theme is counted."""
    a = b = 0
    for t in names.split():
        i = bits.get(t)
        if i is None:
            if len(bits) >= MAX_BITS or not (t.isascii() and t.isalnum() and len(t) <= 40):
                continue
            i = bits[t] = len(bits)
        counts[t] = counts.get(t, 0) + 1
        if i < 63:
            a |= 1 << i
        else:
            b |= 1 << (i - 63)
    return a, b


# ---------------------------------------------------------------- the database
class PuzzleDB:
    TRIES = 5          # download attempts per install; each one resumes where the last one stopped
    RETRY_WAIT = 3     # seconds, times the attempt number

    def __init__(self, data_dir, url=URL):
        self.dir = Path(data_dir) / "puzzles"
        self.path = self.dir / "lichess.sqlite"
        self.tmp = self.dir / "lichess.sqlite.tmp"
        self.zst = self.dir / "lichess_db_puzzle.csv.zst"
        self.url = os.environ.get("AICHESS_PUZZLE_URL") or url
        self.lock = threading.Lock()   # one connection for every request thread, and the tables loaded from it
        self.stop = threading.Event()
        self.db = self.info = self.job = self.thread = self.broken = None
        self.rnd = random.Random()
        for f in self.dir.glob("*.tmp*"):   # a build cut off when the program quit: it starts over next time
            try:
                f.unlink()
            except OSError:
                pass
        with self.lock:
            self._open()

    def _f(self, suffix):
        return self.dir / (self.zst.name + suffix)

    # ---------- status
    def status(self):
        with self.lock:
            info = self.info
            job = dict(self.job) if self.job else None
            if not job and self.broken:
                job = {"state": "error", "step": self.broken, "done": 0, "total": 0}
        out = {"installed": bool(info), "rows": 0, "size": 0, "built": None, "range": None, "themes": [],
               "job": job, "zstd": ZSTD, "free": self.free(), "need": 0 if info else self.need()}
        if info:
            out.update(info)
        return out

    def busy(self):
        job = self.job
        return bool(job and job.get("state") == "running")

    def need(self):
        """Disk space the install still needs: less once some of the download is here."""
        return max(0, NEED - max(size(self.zst), size(self._f(".part"))))

    def free(self):
        p = self.dir
        while not p.exists() and p != p.parent:
            p = p.parent
        try:
            return shutil.disk_usage(p).free
        except OSError:
            return 0

    # ---------- open / close (lock held)
    def _open(self):
        """Open the installed database read-only and load its small tables."""
        self._close()
        if not self.path.exists():
            return
        db = None
        try:
            db = sqlite3.connect(self.path, check_same_thread=False)
            db.execute("PRAGMA query_only = ON")   # read-only, without a file: URI (those trip over Windows network paths)
            meta = dict(db.execute("SELECT k, v FROM meta"))
            if str(meta.get("schema")) != str(SCHEMA):
                raise sqlite3.DatabaseError(f"it was made by a different version (schema {meta.get('schema')})")
            ratings = db.execute("SELECT rating, n FROM ratings WHERE n > 0 ORDER BY rating").fetchall()
            themes = db.execute("SELECT name, bit, n FROM themes").fetchall()
            if not ratings:
                raise sqlite3.DatabaseError("it has no puzzles")
        except sqlite3.Error as e:
            if db:
                db.close()
            self.broken = f"the puzzle database could not be opened ({e}). Remove it and install it again"
            return
        self.db, self.broken, self.misses = db, None, set()
        self.R = [r for r, _ in ratings]
        self.cum = list(itertools.accumulate(n for _, n in ratings))   # puzzles up to and including each rating
        self.bits = {t: (bit, n) for t, bit, n in themes if 0 <= bit < MAX_BITS}
        self.names = {bit: t for t, (bit, n) in self.bits.items()}
        self.info = {"rows": self.cum[-1], "size": size(self.path), "built": meta.get("built_at"),
                     "range": [self.R[0], self.R[-1]],
                     "themes": [{"name": t, "n": n} for t, (bit, n) in sorted(self.bits.items()) if n > 0]}

    def _close(self):
        """Windows can't replace or delete a file that is open, so the connection closes first."""
        if self.db:
            self.db.close()
        self.db = self.info = None

    # ---------- install
    def install(self):
        """Download and build in the background. Does nothing while a job runs or once the database is installed."""
        with self.lock:
            if self.db or self.busy() or (self.thread and self.thread.is_alive()):
                return
            self.stop.clear()
            self.job = {"state": "running", "step": "checking disk space", "done": 0, "total": 0}
            self.thread = threading.Thread(target=self._install, daemon=True)
            self.thread.start()

    def _job(self, **kw):
        job = self.job
        if job:
            job.update(kw)

    def _install(self):
        try:
            if not ZSTD:
                raise Failed("unpacking the puzzles needs Python 3.14 or newer, or the zstandard package "
                             "(pip install zstandard). The downloadable program has it built in")
            self.dir.mkdir(parents=True, exist_ok=True)
            need, free = self.need(), self.free()
            if free < need:
                raise Failed(f"not enough disk space: the puzzles need about {need / 1e9:.1f} GB free, "
                             f"there is {free / 1e9:.1f} GB")
            if not self.zst.exists():
                self._job(step="downloading")
                self._download()
            self._job(step="building the puzzle database", done=0, total=size(self.zst))
            self._build()
            self._job(state="done", step="done")
        except Cancelled:
            try:
                for f in self.dir.glob("lichess*"):
                    drop(f)
            except OSError:
                pass
            self.job = None
        except BadFile as e:   # a damaged file would fail the same way every time: fetch it again next time
            drop(self.zst, self._f(".json"))
            self._job(state="error", step=str(e))
        except Exception as e:   # never let a job take the server down: the page shows the reason
            self._job(state="error", step=explain(e))
        finally:
            try:
                drop(self.tmp)
            except OSError:
                pass

    def _download(self):
        for attempt in range(1, self.TRIES + 1):
            try:
                return self._fetch()
            except (OSError, http.client.HTTPException) as e:
                final = isinstance(e, urllib.error.HTTPError) and e.code < 500 or getattr(e, "errno", None) == errno.ENOSPC
                if final or attempt == self.TRIES:
                    raise
            if self.stop.wait(self.RETRY_WAIT * attempt):
                raise Cancelled

    def _fetch(self):
        """One download attempt into <zst>.part, with what is needed to resume in <zst>.part.json.
        Resumes with Range + If-Range: if the file changed upstream the server sends all of it again (200),
        so two versions never get glued together."""
        part, info = self._f(".part"), self._f(".part.json")
        have = size(part)
        meta = load(info) if have else {}
        if meta.get("url") != self.url:
            have, meta = 0, {}
        etag = meta.get("etag") or ""
        tag = (etag if not etag.startswith("W/") else "") or meta.get("last_modified")   # If-Range needs a strong validator
        h = dict(UA)
        if have and tag:
            h.update({"Range": f"bytes={have}-", "If-Range": tag})
        try:
            r = urllib.request.urlopen(urllib.request.Request(self.url, headers=h), timeout=60)
        except urllib.error.HTTPError as e:
            if e.code != 416 or "Range" not in h:
                raise
            drop(part, info)   # the saved part doesn't fit the file any more: start over
            return self._fetch()
        with r:
            length = int(r.headers.get("Content-Length") or 0)
            if r.status == 206 and "Range" in h:
                m = re.match(r"bytes (\d+)-\d+/(\d+)", r.headers.get("Content-Range", ""))
                if m and int(m.group(1)) != have:
                    drop(part, info)
                    raise ConnectionError("the server resumed at the wrong place")
                got, mode, total = have, "ab", int(m.group(2)) if m else have + length
            else:
                got, mode, total = 0, "wb", length
                meta = {"url": self.url, "etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified"), "total": total}
                info.write_text(json.dumps(meta), encoding="utf-8")
            self._job(done=got, total=total)
            with open(part, mode) as f:
                while chunk := r.read(1 << 16):
                    if self.stop.is_set():
                        raise Cancelled
                    f.write(chunk)
                    got += len(chunk)
                    self._job(done=got)
        if total and got != total:
            if got > total:
                drop(part, info)
            raise ConnectionError(f"the download stopped at {got / 1e6:.1f} of {total / 1e6:.1f} MB")
        os.replace(part, self.zst)
        os.replace(info, self._f(".json"))

    def _build(self):
        """Stream the .zst into lichess.sqlite.tmp, then swap it in. Progress: compressed bytes read."""
        drop(self.tmp)
        src, read = load(self._f(".json")), [0]

        def on_read(n):
            if self.stop.is_set():
                raise Cancelled
            read[0] += n
            self._job(done=read[0])

        db = sqlite3.connect(self.tmp, isolation_level=None)
        try:
            db.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-64000;" + TABLES)
            bits, counts, seq = {t: i for i, t in enumerate(SEED)}, {}, {}
            batch, rows, skipped = [], 0, 0
            ins = "INSERT INTO puzzles VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            db.execute("BEGIN")
            with open(self.zst, "rb") as f:
                text = io.TextIOWrapper(io.BufferedReader(ChunkReader(unzstd(f, on_read)), 1 << 16), encoding="utf-8", newline="")
                try:
                    reader = csv.reader(text)
                    first = next(reader, [])
                    col = {name.strip().lstrip("\ufeff"): i for i, name in enumerate(first)}
                    if not all(c in col for c in FIELDS[:5]):
                        if len(first) < 8 or not first[3].isdigit():
                            raise BadFile("the download is not the lichess puzzle file")
                        col = {c: i for i, c in enumerate(HEADER)}   # older files had no header line
                        reader = itertools.chain([first], reader)
                    ci, cf, cm, cr, ct, cp = (col.get(c) for c in FIELDS)
                    for row in reader:
                        try:
                            pid, fen, moves, names, r = row[ci], row[cf], row[cm], row[ct], int(row[cr])
                            pop = int(row[cp] or 0) if cp is not None else 0
                        except (IndexError, ValueError):
                            skipped += 1
                            continue
                        n = seq.get(r, 0)
                        # the first move is the opponent's, so a puzzle has two moves at least
                        if not (pid and " " in fen and " " in moves and 0 <= r < 10000 and n < 1 << 20):
                            skipped += 1
                            continue
                        seq[r] = n + 1
                        batch.append((r << 20 | n, pid, fen, moves, r, pop, *theme_mask(names, bits, counts)))
                        if len(batch) >= 20000:
                            db.executemany(ins, batch)
                            rows += len(batch)
                            batch.clear()
                except BAD_DATA as e:
                    raise BadFile(f"the downloaded puzzle file is damaged ({e}). Install again to download a fresh copy") from None
            if batch:
                db.executemany(ins, batch)
                rows += len(batch)
            if not rows:
                raise BadFile("the download has no puzzles in it")
            db.executemany("INSERT INTO ratings VALUES (?, ?)", sorted(seq.items()))
            db.executemany("INSERT INTO themes VALUES (?, ?, ?)", [(t, i, counts.get(t, 0)) for t, i in bits.items()])
            db.executemany("INSERT INTO meta VALUES (?, ?)", [
                ("schema", SCHEMA), ("rows", rows), ("skipped", skipped), ("source_url", self.url), ("etag", src.get("etag")),
                ("last_modified", src.get("last_modified")), ("built_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))])
            db.execute("COMMIT")
        finally:
            db.close()
        with self.lock:
            self._close()
            os.replace(self.tmp, self.path)
            self._open()
            if not self.db:
                raise Failed(self.broken)
        drop(self.zst, self._f(".json"))

    # ---------- remove
    def remove(self):
        """Stop a running install, then delete the database and every download file."""
        t = self.thread
        if t and t.is_alive():
            self.stop.set()
            t.join(20)
        with self.lock:
            self._close()
            self.job = self.broken = None
            try:
                for f in self.dir.glob("lichess*"):
                    drop(f)
            except OSError as e:
                raise RuntimeError(f"could not delete the puzzle database: {e}") from None
        try:
            self.dir.rmdir()
        except OSError:
            pass

    # ---------- pick
    def pick(self, rating, window=None, themes=None, exclude=None, count=1):
        """Random puzzles near a rating, shaped like web/puzzles/puzzles.json entries: [{id, fen, moves, r, t}].
        The window (default 100 either side) doubles until enough puzzles are found; every theme asked for must be on the puzzle;
        exclude: ids already seen (the last 600 count). Fewer than count, or none, when not enough match."""
        rating, window, count = num(rating, None), max(10, min(num(window, 100), 4000)), max(1, min(num(count, 1), 10))
        if rating is None:
            raise ValueError("rating is missing")
        if not isinstance(themes, (list, str, type(None))) or not isinstance(exclude, (list, type(None))):
            raise ValueError("themes and exclude are lists")
        names = themes.split() if isinstance(themes, str) else [str(t) for t in themes or []]
        seen = {str(x) for x in (exclude or [])[-600:]}
        with self.lock:
            if not self.db:
                raise RuntimeError("not installed")
            bad = [t for t in names if t not in self.bits]
            if bad:
                raise ValueError("unknown theme: " + ", ".join(bad[:5]))
            try:
                return [{"id": p[0], "fen": p[1], "moves": p[2], "r": p[3], "t": self._theme_names(p[4], p[5])}
                        for p in self._pick(rating, window, names, seen, count)]
            except sqlite3.Error as e:
                raise RuntimeError(f"the puzzle database could not be read: {e}") from None

    def _pick(self, rating, window, names, seen, count):
        a = b = 0
        for t in names:
            bit = self.bits[t][0]
            if bit < 63:
                a |= 1 << bit
            else:
                b |= 1 << (bit - 63)
        if (a, b) in self.misses:
            return []
        total = self.cum[-1]
        rare = min((self.bits[t][1] for t in names), default=total)
        if rare == 0:   # a known theme that no puzzle in this file has
            return []
        rating = min(max(rating, self.R[0]), self.R[-1])   # a rating past either end starts from the nearest puzzles
        # hole: ratings (indexes into R) already scanned without a match, so a wider window only reads the new rows around it
        out, w, hole = [], window, None
        while True:
            lo, hi = rating - w, rating + w
            full = lo <= self.R[0] and hi >= self.R[-1]
            i, j = bisect.bisect_left(self.R, lo), bisect.bisect_right(self.R, hi) - 1
            parts = [(i, j)] if not hole else [(i, hole[0] - 1), (hole[1] + 1, j)]
            parts = [s for s in parts if s[0] <= s[1]]
            # skip a window where the rarest theme is unlikely to show up enough: a scan that finds nothing reads every row
            if parts and (full or self._rows(parts) * rare / total >= 2 * count):
                for _ in range(4 * count + 4):
                    p = self._one(parts, a, b, seen)
                    if p is None:   # nothing in this window has the themes
                        hole = (i, j)
                        break
                    if p:
                        out.append(p)
                        seen.add(p[0])
                        if len(out) == count:
                            return out
            if full:
                if names and hole == (0, len(self.R) - 1):
                    self.misses.add((a, b))
                return out
            w *= 2

    def _rows(self, parts):
        return sum(self.cum[j] - (self.cum[i - 1] if i else 0) for i, j in parts)

    def _spot(self, parts):
        """A random puzzle with a rating in one of the parts (spans of indexes into R), every puzzle equally likely:
        (its key, which part)."""
        x = self.rnd.randrange(self._rows(parts))
        for n, (i, j) in enumerate(parts):
            base = self.cum[i - 1] if i else 0
            if x < self.cum[j] - base:
                break
            x -= self.cum[j] - base
        m = bisect.bisect_right(self.cum, x + base, i, j + 1)
        return self.R[m] << 20 | (x + base - (self.cum[m - 1] if m else 0)), n

    def _one(self, parts, a, b, seen):
        """One puzzle not in seen; False when only seen ones turned up, None when nothing in the parts has the themes."""
        x, n = self._spot(parts)
        if not (a or b):
            p = self.db.execute(f"SELECT {COLS} FROM puzzles WHERE k = ?", (x,)).fetchone()
            return p if p and p[0] not in seen else False
        # scan from a random puzzle (not a random key: keys leave big gaps between ratings) to the end, then wrap around
        # one of the next few matches, not always the first: a match right behind another would hardly ever come up
        keys = [(self.R[i] << 20, self.R[j] << 20 | 0xFFFFF) for i, j in parts]
        found, cands = False, []
        for span in [(x, keys[n][1])] + keys[n + 1:] + keys[:n] + [(keys[n][0], x - 1)]:
            for p in self.db.execute(SCAN, (*span, a, a, b, b)):
                found = True
                if p[0] not in seen:
                    cands.append(p)
            if len(cands) >= 4:
                break
        return self.rnd.choice(cands[:4]) if cands else False if found else None

    def _theme_names(self, a, b):
        out, m = [], a | b << 63
        while m:
            low = m & -m
            if (t := self.names.get(low.bit_length() - 1)):
                out.append(t)
            m ^= low
        return " ".join(sorted(out))
