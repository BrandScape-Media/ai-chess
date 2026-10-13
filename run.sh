#!/usr/bin/env sh
# AI Chess on Linux / macOS: needs Python 3.10+ (standard library only)
cd "$(dirname "$0")" && exec python3 server.py "$@"
