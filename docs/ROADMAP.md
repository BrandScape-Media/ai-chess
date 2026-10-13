# Roadmap

What comes next, in build order. Done items move to the README.

## Game Review (next)

Already in: accuracy for both sides, a clickable evaluation graph, key moments (`[` `]`), a coach line per move, and **Retry your mistake** (the position before an inaccuracy, mistake or blunder becomes a mini puzzle; any move within about 4% win chance of the engine's best counts).

Decided:
* **Ship Stockfish with the game.** It is installed with the app, not as an optional download. **Deep analysis is the default** for Game Review. The built-in engine stays as the fallback.
* **Retry your mistake is the centrepiece** (learning). Grow it into a full drill: retry every mistake of the game one after another, show the answer after two tries, and keep a "mistakes to practise" list from past games that comes back like puzzles.

Next:
1. **Full review screen**: summary header (accuracy, an estimated game rating, a count table per side for every class), the evaluation graph larger, move list with marks, and the coach.
2. **Deep review by default** with the bundled Stockfish (`/api/engine/go`, higher depth), with progress shown on the graph. Keep the evaluations with the game in the history so a review reopens instantly.
3. **Coach**: template lines from the engine's numbers first (done). Then an optional "Explain with my AI model": the local model gets the FEN, the move played, the engine's best move, the line and the swing, and may only explain those facts, so it doesn't make things up. Cached per move.
4. Opening name and a "Book" label for the first moves (small ECO list).

## Puzzles

1. Daily puzzle with a streak.
2. Themes dashboard: accuracy per theme (lichess themes), "Practise this theme".
3. Storm-style combos in Puzzle Rush: bonus seconds for runs of correct moves, a time penalty for a miss.
4. Puzzle Battle against a bot that solves at a simulated rating.
5. Optional download of the full lichess puzzle database (about 5 million puzzles, offline). Python's standard library has no zstd before 3.14, so host a repacked, rating-bucketed copy on the Releases page and serve it through `/api/puzzles?rating=&theme=`.

## Tournaments

Engines and AI models play each other in the background, and you play your own games on the main board.

* A background match runner (engines through `/api/engine/go`, models through `/api/llm/chat`, one local model at a time), results in `data/tournaments.json`.
* Formats, in order: round-robin / Swiss (Buchholz tie-break), knockout (winner plays winner), timed arena (most consecutive wins, streak bonus), and a "most Elo gained" event.
* A Tournaments tab: lobby with presets, live standings or bracket, "your next game" cards, mini boards of the background games.
* Later: Leagues from Wood to Legends.

## Why (what makes the big sites sticky)

* Game Review is the feature people pay for: accuracy, move labels, key moments, a coach, retrying your mistakes.
* Puzzle Rush and Puzzle Battle give you a score to beat.
* Leagues give you something to climb.
* There is always an opponent at your level.
