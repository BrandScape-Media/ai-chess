#!/usr/bin/env python3
"""ai-chess: play chess against your local AI models (or cloud ones, or real chess engines) in the browser.

A small standard-library server: it serves the page in web/, keeps settings and the current game in data/,
forwards chat requests to the AI provider you pick (LM Studio, Ollama, llama.cpp, ... or OpenAI, Anthropic, ...)
and runs UCI chess engines (see uci.py). The page is the only rules authority.

    python server.py            -> http://localhost:8800 opens in your browser
    python server.py --help

GPL-3.0-or-later. https://github.com/BrandScape-Media/ai-chess
"""
import argparse
import ipaddress
import json
import mimetypes
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from puzzledb import PuzzleDB
from uci import Engines

VERSION = "1.3.2"
FROZEN = getattr(sys, "frozen", False)
APP_DIR = Path(sys.executable if FROZEN else __file__).resolve().parent
BUNDLE = Path(getattr(sys, "_MEIPASS", APP_DIR))
WEB = APP_DIR / "web" if (APP_DIR / "web" / "index.html").exists() else BUNDLE / "web"
DATA = APP_DIR / "data"
FREE_MOVE = re.compile(r"[a-h][1-8][a-h][1-8][qrbn]?|[kqrbnp]@[a-h][1-8]")

# Built-in AI providers. Local apps first (default ports), then cloud APIs (need a key).
PROVIDERS = [
    {"id": "lmstudio", "name": "LM Studio", "base": "http://127.0.0.1:1234/v1", "local": True},
    {"id": "ollama", "name": "Ollama", "base": "http://127.0.0.1:11434/v1", "local": True},
    {"id": "llamacpp", "name": "llama.cpp server / llama-swap", "base": "http://127.0.0.1:8080/v1", "local": True},
    {"id": "jan", "name": "Jan", "base": "http://127.0.0.1:1337/v1", "local": True},
    {"id": "koboldcpp", "name": "KoboldCpp", "base": "http://127.0.0.1:5001/v1", "local": True},
    {"id": "textgen", "name": "text-generation-webui", "base": "http://127.0.0.1:5000/v1", "local": True},
    {"id": "vllm", "name": "vLLM", "base": "http://127.0.0.1:8000/v1", "local": True},
    {"id": "gpt4all", "name": "GPT4All", "base": "http://127.0.0.1:4891/v1", "local": True},
    {"id": "openai", "name": "OpenAI", "base": "https://api.openai.com/v1"},
    {"id": "anthropic", "name": "Anthropic (Claude)", "base": "https://api.anthropic.com/v1", "kind": "anthropic"},
    {"id": "gemini", "name": "Google Gemini", "base": "https://generativelanguage.googleapis.com/v1beta/openai"},
    {"id": "openrouter", "name": "OpenRouter", "base": "https://openrouter.ai/api/v1"},
    {"id": "groq", "name": "Groq", "base": "https://api.groq.com/openai/v1"},
    {"id": "mistral", "name": "Mistral", "base": "https://api.mistral.ai/v1"},
    {"id": "deepseek", "name": "DeepSeek", "base": "https://api.deepseek.com/v1"},
    {"id": "xai", "name": "xAI (Grok)", "base": "https://api.x.ai/v1"},
    {"id": "together", "name": "Together AI", "base": "https://api.together.xyz/v1"},
]

cond = threading.Condition()
state = {}           # last game state pushed by the page
pending = None       # relay move waiting for the page
polls = 0
last_seen = 0.0
active_page = None   # the window that owns the game (the last one opened)
settings = {}
settings_lock = threading.Lock()
quirks = {}          # (provider, model) -> request params that provider rejected
CFG = {"agent": None, "lan": False, "port": 8800}   # agent: name of the hidden relay player (local.json)
engines = None
puzzles = None       # the optional offline lichess puzzle database (puzzledb.py)


# ---------------------------------------------------------------- storage
def data_path(name):
    return DATA / name


def save_json(path, obj):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(obj, indent=1), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def providers():
    """Built-in presets (with the user's base/key overrides) followed by custom providers."""
    over = {p["id"]: p for p in settings.get("providers", [])}
    out = []
    for p in PROVIDERS:
        q = dict(p, kind=p.get("kind", "openai"), builtin=True)
        o = over.get(p["id"], {})
        if o.get("base"):
            q["base"] = o["base"]
        q["key"] = o.get("key", "")
        out.append(q)
    for o in settings.get("providers", []):
        if o.get("custom"):
            out.append({"id": o["id"], "name": o.get("name") or o["id"], "base": o.get("base", ""), "key": o.get("key", ""),
                        "kind": o.get("kind", "openai"), "custom": True, "local": is_private(o.get("base", ""))})
    return out


def provider(pid):
    p = next((x for x in providers() if x["id"] == pid), None)
    if not p:
        raise ValueError(f"unknown provider '{pid}'")
    if not p.get("base"):
        raise ValueError(f"provider '{p['name']}' has no URL")
    return p


def masked_settings():
    s = json.loads(json.dumps(settings))
    s["providers"] = []
    for p in providers():
        q = {k: v for k, v in p.items() if k != "key"}
        q["keySet"] = bool(p.get("key"))
        q["keyHint"] = ("…" + p["key"][-4:]) if p.get("key") else ""
        s["providers"].append(q)
    return s


def update_settings(new):
    """Merge settings from the page. API keys are write-only: an empty key keeps the stored one, clearKey removes it."""
    with settings_lock:
        old = {p["id"]: p for p in settings.get("providers", [])}
        provs = []
        for p in new.get("providers", []):
            pid = str(p.get("id", ""))[:60]
            if not pid:
                continue
            o = old.get(pid, {})
            q = {"id": pid}
            if p.get("custom"):
                q.update(custom=True, name=str(p.get("name", pid))[:80], kind="anthropic" if p.get("kind") == "anthropic" else "openai")
            builtin = next((b for b in PROVIDERS if b["id"] == pid), None)
            base = str(p.get("base", "")).strip()
            if base and (not builtin or base != builtin["base"]):
                q["base"] = base
            elif p.get("custom"):
                q["base"] = base
            key = p.get("key")
            if p.get("clearKey"):
                pass
            elif key:
                q["key"] = str(key).strip()
            elif o.get("key"):
                q["key"] = o["key"]
            if len(q) > 1 or p.get("custom"):
                provs.append(q)
        for k, v in new.items():
            if k != "providers":
                settings[k] = v
        settings["providers"] = provs
        save_json(data_path("settings.json"), settings)


# ---------------------------------------------------------------- AI providers
def is_private(url):
    try:
        host = urlparse(url if "://" in url else "http://" + url).hostname
        if not host:
            return False
        if host == "localhost":
            return True
        ip = ipaddress.ip_address(socket.gethostbyname(host))
        return ip.is_private or ip.is_loopback
    except (OSError, ValueError):
        return False


def norm_base(base):
    u = urlparse(base if "://" in base else "http://" + base)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("the provider URL must start with http:// or https://")
    path = u.path.rstrip("/")
    if not path:
        path = "/v1"   # most local apps: http://host:port -> http://host:port/v1
    return f"{u.scheme}://{u.netloc}{path}"


def http(method, url, body=None, headers=None, timeout=900):
    data = None if body is None else json.dumps(body).encode()
    h = {"Content-Type": "application/json", "User-Agent": f"ai-chess/{VERSION}"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, OSError) as e:
        reason = getattr(e, "reason", e)
        return 502, json.dumps({"error": f"cannot reach {urlparse(url).netloc}: {reason}"}).encode()


def err_text(data):
    try:
        j = json.loads(data)
        e = j.get("error", j)
        if isinstance(e, dict):
            return str(e.get("message") or e)
        return str(e)
    except ValueError:
        return data.decode("utf-8", "replace")[:500]


def auth(p):
    if p["kind"] == "anthropic":
        return {"x-api-key": p.get("key", ""), "anthropic-version": "2023-06-01"}
    h = {"Authorization": f"Bearer {p['key']}"} if p.get("key") else {}
    if "openrouter.ai" in p["base"]:
        h.update({"HTTP-Referer": "https://github.com/BrandScape-Media/ai-chess", "X-Title": "ai-chess"})
    return h


def list_models(pid):
    p = provider(pid)
    base = norm_base(p["base"])
    if p.get("kind") != "anthropic" and not p.get("local") and not p.get("key"):
        return 400, {"error": f"{p['name']} needs an API key: add it in Settings > AI providers"}
    code, data = http("GET", base + "/models", headers=auth(p), timeout=15)
    if code != 200:
        return code, {"error": err_text(data)}
    try:
        items = json.loads(data).get("data", [])
    except ValueError:
        return 502, {"error": "the provider did not return a model list"}
    models = [{"id": m.get("id"), "name": m.get("display_name") or m.get("name") or m.get("id")} for m in items if m.get("id")]
    if p.get("local"):   # which ones are loaded right now (LM Studio, llama-swap)
        root = base[:-3] if base.endswith("/v1") else base
        extra = {}
        c2, d2 = http("GET", root + "/api/v0/models", timeout=5)
        if c2 == 200:
            try:
                for m in json.loads(d2).get("data", []):
                    extra[m.get("id")] = {"loaded": m.get("state") == "loaded", "vision": m.get("type") == "vlm", "kind": m.get("type")}
            except ValueError:
                pass
        else:
            c3, d3 = http("GET", root + "/running", timeout=5)
            if c3 == 200:
                try:
                    for r in json.loads(d3).get("running", []):
                        extra[r.get("model")] = {"loaded": True}
                except ValueError:
                    pass
        for m in models:
            m.update(extra.get(m["id"], {}))
    return 200, {"data": models}


THINK_BUDGET = {"low": 1024, "medium": 4000, "high": 10000, "xhigh": 10000}


def chat(req):
    """req: {provider, model, messages (OpenAI format, images as data URLs), max_tokens, temperature, think}.
    Returns (status, OpenAI-style completion JSON). Parameters a provider rejects are dropped and remembered."""
    p = provider(req.get("provider"))
    base = norm_base(p["base"])
    model = req.get("model")
    if p["kind"] == "anthropic":
        return anthropic_chat(p, base, req)
    q = quirks.setdefault((p["id"], model), set())
    think = req.get("think") or "none"
    for _ in range(5):
        body = {"model": model, "messages": req["messages"]}
        if req.get("max_tokens"):
            body["max_completion_tokens" if "mct" in q else "max_tokens"] = req["max_tokens"]
        if req.get("temperature") is not None and "temp" not in q:
            body["temperature"] = req["temperature"]
        if p.get("local"):
            if "kwargs" not in q:
                body["chat_template_kwargs"] = {"reasoning_effort": think, "enable_thinking": think != "none"}
        elif think != "none" and "reason" not in q:
            body["reasoning_effort"] = "high" if think == "xhigh" else think
        code, data = http("POST", base + "/chat/completions", body, auth(p))
        if code in (400, 422):
            t = err_text(data).lower()
            if "max_completion_tokens" in t and "mct" not in q:
                q.add("mct")
            elif "temperature" in t and "temp" not in q:
                q.add("temp")
            elif "reasoning" in t and "reason" not in q and "reasoning_effort" in body:
                q.add("reason")
            elif ("chat_template_kwargs" in t or "enable_thinking" in t or "unrecognized" in t or "extra" in t) and "kwargs" not in q and "chat_template_kwargs" in body:
                q.add("kwargs")
            else:
                return code, {"error": err_text(data)}
            continue
        if code != 200:
            return code, {"error": err_text(data)}
        try:
            return 200, json.loads(data)
        except ValueError:
            return 502, {"error": "the provider returned something that is not JSON"}
    return 400, {"error": "the provider kept rejecting the request"}


def anthropic_chat(p, base, req):
    system, msgs = [], []
    for m in req["messages"]:
        if m["role"] == "system":
            system.append(m["content"] if isinstance(m["content"], str) else " ".join(x.get("text", "") for x in m["content"]))
            continue
        parts = m["content"] if isinstance(m["content"], list) else [{"type": "text", "text": m["content"]}]
        blocks = []
        for x in parts:
            if x.get("type") == "text":
                blocks.append({"type": "text", "text": x.get("text") or "."})
            elif x.get("type") == "image_url":
                url = x["image_url"]["url"]
                mt = re.match(r"data:([^;]+);base64,(.*)", url, re.S)
                if mt:
                    blocks.append({"type": "image", "source": {"type": "base64", "media_type": mt.group(1), "data": mt.group(2)}})
        msgs.append({"role": m["role"], "content": blocks})
    think = req.get("think") or "none"
    for use_think in ([True, False] if think != "none" else [False]):
        mt = int(req.get("max_tokens") or 1024)
        body = {"model": req.get("model"), "messages": msgs, "max_tokens": mt}
        if system:
            body["system"] = "\n\n".join(system)
        if use_think:
            budget = THINK_BUDGET.get(think, 1024)
            body["thinking"] = {"type": "enabled", "budget_tokens": budget}
            body["max_tokens"] = budget + mt
        elif req.get("temperature") is not None:
            body["temperature"] = min(1.0, float(req["temperature"]))
        code, data = http("POST", base + "/messages", body, auth(p))
        if code == 400 and use_think:
            continue
        if code != 200:
            return code, {"error": err_text(data)}
        j = json.loads(data)
        text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
        reasoning = "".join(b.get("thinking", "") for b in j.get("content", []) if b.get("type") == "thinking")
        return 200, {"choices": [{"message": {"role": "assistant", "content": text, "reasoning_content": reasoning}}], "usage": j.get("usage")}
    return 400, {"error": "Anthropic rejected the request"}


# ---------------------------------------------------------------- HTTP
def connected():
    return polls > 0 or time.time() - last_seen < 5


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json", cache=False):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=300" if cache else "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def allowed(self):
        """Block DNS rebinding and cross-site requests: the page is the only client."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        if not CFG["lan"] and host not in ("localhost", "127.0.0.1", "::1"):
            return False
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
            return False
        return True

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 40_000_000:
            raise ValueError("too big")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw or b"{}")

    def static(self, path):
        rel = unquote(path).lstrip("/") or "index.html"
        f = (WEB / rel).resolve()
        if WEB.resolve() not in f.parents and f != WEB.resolve() or not f.is_file():
            return self.send(404, {"error": "not found"})
        ctype = {".webp": "image/webp", ".woff2": "font/woff2"}.get(f.suffix) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix in (".js", ".mjs"):
            ctype = "text/javascript"
        if ctype.startswith("text/") or f.suffix == ".svg":
            ctype += "; charset=utf-8"
        self.send(200, f.read_bytes(), ctype, cache=f.suffix in (".svg", ".png", ".ico", ".webp", ".woff2"))

    def do_GET(self):
        global pending, polls, last_seen, active_page
        if not self.allowed():
            return self.send(403, {"error": "forbidden"})
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not u.path.startswith("/api/"):
            return self.static(u.path)
        if u.path == "/api/config":
            self.send(200, {"version": VERSION, "agent": CFG["agent"], "platform": sys.platform, "lan": CFG["lan"], "frozen": FROZEN})
        elif u.path == "/api/settings":
            self.send(200, masked_settings())
        elif u.path == "/api/state":
            with cond:
                out = dict(state)
                out["browserConnected"] = connected()
            self.send(200, out)
        elif u.path == "/api/pending":
            wait = min(float(q.get("wait", ["0"])[0]), 25)
            page = q.get("page", [None])[0]
            with cond:
                if active_page is None and page:
                    active_page = page
                polls += 1
                try:
                    end = time.time() + wait
                    mine = lambda: active_page is None or page == active_page
                    while (pending is None or not mine()) and time.time() < end:
                        if not mine() and page:
                            break
                        cond.wait(1.0)
                    move = None
                    if mine():
                        move, pending = pending, None
                finally:
                    polls -= 1
                    last_seen = time.time()
            self.send(200, {"move": move, "inactive": not mine()})
        elif u.path == "/api/engines":
            self.send(200, engines.listing())
        elif u.path == "/api/puzzles":
            self.send(200, puzzles.status())
        elif u.path == "/api/health":
            self.send(200, {"ok": True, "app": "ai-chess"})
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        global state, pending, active_page
        if not self.allowed() or "application/json" not in (self.headers.get("Content-Type") or ""):
            return self.send(403, {"error": "forbidden"})
        u = urlparse(self.path)
        try:
            data = self.body()
        except ValueError:
            return self.send(400, {"error": "bad json"})
        try:
            self.route(u.path, data)
        except (ValueError, FileNotFoundError, TimeoutError, RuntimeError) as e:
            self.send(400, {"error": str(e)})

    def route(self, path, data):
        global state, pending, active_page
        if path == "/api/hello":
            with cond:
                active_page = data.get("page")
                cond.notify_all()
            self.send(200, {"ok": True})
        elif path == "/api/sync":
            with cond:
                if active_page is None and data.get("page"):
                    active_page = data["page"]
                if active_page and data.get("page") != active_page:
                    return self.send(409, {"error": "the game is open in another window", "inactive": True})
                state = data
                save_json(data_path(CFG.get("state", "last_game.json")), state)
                cond.notify_all()
            self.send(200, {"ok": True})
        elif path == "/api/settings":
            update_settings(data)
            self.send(200, masked_settings())
        elif path == "/api/llm/models":
            self.send(*list_models(data.get("provider")))
        elif path == "/api/llm/chat":
            self.send(*chat(data))
        elif path == "/api/engine/go":
            self.send(200, engines.go(data))
        elif path == "/api/engines/install":
            engines.install(data.get("id"))
            self.send(200, engines.listing())
        elif path == "/api/engines/add":
            self.send(200, {"engine": engines.add_custom(str(data.get("path", "")), data.get("name") or None, data.get("args") or [])})
        elif path == "/api/engines/remove":
            engines.remove(data.get("id"))
            self.send(200, engines.listing())
        elif path == "/api/engines/browse":
            self.send(200, {"path": browse_file() if self.client_address[0] in ("127.0.0.1", "::1") else None})
        elif path == "/api/puzzles/install":
            puzzles.install()
            self.send(200, puzzles.status())
        elif path == "/api/puzzles/remove":
            puzzles.remove()
            self.send(200, puzzles.status())
        elif path == "/api/puzzles/pick":
            self.send(200, {"puzzles": puzzles.pick(data.get("rating"), data.get("window"), data.get("themes"),
                                                    data.get("exclude"), data.get("count"))})
        elif path == "/api/history":
            self.send(200, {"games": history(data)})
        elif path == "/api/practice":
            self.send(200, {"items": practice(data)})
        elif path == "/api/tournaments":
            self.send(200, {"tournaments": tournaments(data)})
        elif path == "/api/move" and CFG["agent"]:
            self.relay_move(data)
        else:
            self.send(404, {"error": "not found"})

    def relay_move(self, data):
        """Hidden relay player: an agent outside the page (e.g. a coding assistant in a terminal) posts its moves here.
        Off unless local.json names it: {"agent": "My agent"}."""
        global pending
        uci = str(data.get("uci", "")).strip().lower()
        say = str(data.get("say", ""))[:500]
        with cond:
            err = None
            t_end = time.time() + 3
            while state and not connected() and time.time() < t_end:
                cond.wait(0.2)
            if not state:
                err = "no game yet"
            elif not connected():
                err = "the page is not connected"
            elif state.get("over"):
                err = "game is over"
            elif state.get("paused"):
                err = "the game is paused"
            elif not state.get("agentToMove"):
                err = "it is not the agent's turn"
            if err:
                return self.send(409, {"error": err})
            if uci not in state.get("legal", []) and not (state.get("rulesFree") and FREE_MOVE.fullmatch(uci)):
                return self.send(400, {"error": "illegal move", "legal": state.get("legal", [])})
            before = state.get("fen")
            pending = {"uci": uci, "say": say}
            cond.notify_all()
            deadline = time.time() + 8
            while state.get("fen") == before and time.time() < deadline:
                cond.wait(0.25)
            if state.get("fen") == before:
                pending = None
                return self.send(504, {"error": "page did not confirm the move"})
            out = dict(state)
        self.send(200, {"ok": True, "state": out})


history_lock = threading.Lock()


def history(data):
    """Finished games (data/history.json, newest last).
    {"add": game} | {"update": {"id", "review"?, "chat"?}} (the game review once it is done; the chat, its last 60 lines)
    | {"remove": id} | {"clear": true} | {} to list."""
    with history_lock:
        games = load_json(data_path("history.json"), [])
        if not isinstance(games, list):
            games = []
        changed = False
        if isinstance(data.get("add"), dict) and data["add"].get("id"):
            g = data["add"]
            games = [x for x in games if x.get("id") != g["id"]] + [g]
            games = games[-1000:]
            changed = True
        elif isinstance(data.get("update"), dict) and data["update"].get("id"):
            u = data["update"]
            for g in games:
                if g.get("id") != u["id"]:
                    continue
                if isinstance(u.get("review"), dict):
                    g["review"] = u["review"]
                    changed = True
                if isinstance(u.get("chat"), list):
                    g["chat"] = u["chat"][-60:]
                    changed = True
        elif data.get("remove"):
            games = [x for x in games if x.get("id") != data["remove"]]
            changed = True
        elif data.get("clear") is True:
            games, changed = [], True
        if changed:
            save_json(data_path("history.json"), games)
        return games


tournaments_lock = threading.Lock()


def tournaments(data):
    """Tournaments (data/tournaments.json, newest last, at most 60): {"save": t} adds or replaces one by id,
    {"remove": id} deletes one, {} lists them. The page owns the logic; the server only keeps them."""
    with tournaments_lock:
        items = load_json(data_path("tournaments.json"), [])
        if not isinstance(items, list):
            items = []
        changed = False
        if isinstance(data.get("save"), dict) and data["save"].get("id"):
            t = data["save"]
            items = [x for x in items if x.get("id") != t["id"]] + [t]
            items = items[-60:]
            changed = True
        elif data.get("remove"):
            items = [x for x in items if x.get("id") != data["remove"]]
            changed = True
        if changed:
            save_json(data_path("tournaments.json"), items)
        return items


practice_lock = threading.Lock()


def practice(data):
    """Positions from your own games where you went wrong, to practise later (data/practice.json, at most 500).
    {"add": [items]} | {"update": {"id", "tries", "solved", "streak", "last"}} | {"remove": id} | {} to list."""
    with practice_lock:
        items = load_json(data_path("practice.json"), [])
        if not isinstance(items, list):
            items = []
        changed = False
        if isinstance(data.get("add"), list):
            have = {x.get("id") for x in items}
            for it in data["add"]:
                if isinstance(it, dict) and it.get("id") and it["id"] not in have:
                    items.append(it)
                    have.add(it["id"])
                    changed = True
            items = items[-500:]
        if isinstance(data.get("update"), dict) and data["update"].get("id"):
            u = data["update"]
            for it in items:
                if it.get("id") == u["id"]:
                    it.update({k: v for k, v in u.items() if k in ("tries", "solved", "streak", "last")})
                    changed = True
        if data.get("remove"):
            items = [x for x in items if x.get("id") != data["remove"]]
            changed = True
        if changed:
            save_json(data_path("practice.json"), items)
        return items


def browse_file():
    """Native 'open file' dialog on this PC, for picking an engine executable."""
    try:
        import tkinter
        from tkinter import filedialog
    except ImportError:
        return None
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    types = [("Programs", "*.exe"), ("All files", "*.*")] if sys.platform == "win32" else [("All files", "*")]
    path = filedialog.askopenfilename(title="Choose a UCI chess engine", filetypes=types)
    root.destroy()
    return path or None


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def open_page(url, app):
    """--app: a chromeless Edge/Chrome window that feels like a program; otherwise the default browser."""
    if app and sys.platform == "win32":
        roots = [os.environ.get(k, "") for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
        for rel in (("Microsoft", "Edge", "Application", "msedge.exe"), ("Google", "Chrome", "Application", "chrome.exe")):
            for root in roots:
                exe = Path(root, *rel) if root else None
                if exe and exe.exists():
                    subprocess.Popen([str(exe), f"--app={url}", "--window-size=1360,940"])
                    return
    webbrowser.open(url)


def idle_watch(seconds):
    started = time.time()
    while True:
        time.sleep(5)
        # a page that never connected (window closed early, browser missing) counts from the start, with 2 minutes' grace
        seen = last_seen or started + 120
        # a puzzle download or build would be cut off, so it gets to finish first
        if polls == 0 and time.time() - seen > seconds and not puzzles.busy():
            engines.shutdown()
            os._exit(0)


def writable(d):
    try:
        d.mkdir(parents=True, exist_ok=True)
        (d / ".write-test").write_text("x")
        (d / ".write-test").unlink()
        return True
    except OSError:
        return False


def main():
    global DATA, state, settings, engines, puzzles
    ap = argparse.ArgumentParser(description="ai-chess: play chess against local AI models and chess engines")
    ap.add_argument("--port", type=int, default=8800)
    ap.add_argument("--lan", action="store_true", help="listen on all interfaces so other devices can play (they can use your AI providers too)")
    ap.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    ap.add_argument("--app", action="store_true", default=FROZEN, help="open in a chromeless Edge/Chrome window (default for the .exe)")
    ap.add_argument("--tab", dest="app", action="store_false", help="open in a normal browser tab")
    ap.add_argument("--exit-when-idle", type=float, default=90 if FROZEN else 0, metavar="SEC",
                    help="quit when the page has been closed this long (default 90 for the .exe, off otherwise)")
    ap.add_argument("--data", default=None, help="folder for settings, saved game and engines (default: ./data)")
    ap.add_argument("--no-stockfish", action="store_true", help="don't set up Stockfish on the first start")
    a = ap.parse_args()
    DATA = Path(a.data) if a.data else APP_DIR / "data"
    if not writable(DATA):
        DATA = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share", "ai-chess")
        writable(DATA)
    local = load_json(APP_DIR / "local.json", {})
    CFG.update(agent=local.get("agent") or None, lan=a.lan, port=a.port)
    if sys.platform == "win32":   # SO_REUSEADDR on Windows would let a second server share the port
        ThreadingHTTPServer.allow_reuse_address = False
    # several copies can run at once: each takes the next free port and keeps its own saved game
    srv = None
    for port in range(a.port, a.port + 50):
        try:
            srv = ThreadingHTTPServer(("0.0.0.0" if a.lan else "127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if srv is None:
        raise SystemExit(f"no free port between {a.port} and {a.port + 49}")
    CFG["port"] = port
    CFG["state"] = "last_game.json" if port == a.port else f"last_game-{port}.json"
    url = f"http://localhost:{port}"
    srv.daemon_threads = True
    state = load_json(data_path(CFG["state"]), {})
    settings = load_json(data_path("settings.json"), {})
    engines = Engines(DATA)
    puzzles = PuzzleDB(DATA)
    if not a.no_stockfish:   # first start: Stockfish from the copy inside the program, or downloaded (in the background)
        threading.Thread(target=engines.ensure_stockfish, args=(BUNDLE / "engines",), daemon=True).start()
    print(f"ai-chess {VERSION} running at {url}")
    if a.lan and lan_ip():
        print(f"On your network:      http://{lan_ip()}:{port}")
    print(f"Data folder:          {DATA}")
    print("Ctrl+C to stop.")
    if a.exit_when_idle > 0:
        threading.Thread(target=idle_watch, args=(a.exit_when_idle,), daemon=True).start()
    if not a.no_browser:
        threading.Timer(0.4, lambda: open_page(url, a.app)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        engines.shutdown()


if __name__ == "__main__":
    main()
