# Roadmap

What comes next, in build order. Done items move to the README.

## Game Review

Done in 1.3.0: Stockfish ships with the game; deep review (depth 18) by default, saved with the game; the Review tab (accuracy, estimated game rating, opening name and book moves, evaluation graph, every class for both sides including Book and Miss, phases, key moments); a coach that explains every move from the engine's lines; "Explain" with your own AI model, given only the engine's facts; Retry your mistakes, one by one or as a drill (answer after two tries); Your mistakes in Puzzles, until solved twice in a row.

Next:
1. Better "Great" and "Brilliant": the engine's second-best move (MultiPV) to spot only-moves.
2. Mistake themes in the coach (fork, pin, hanging piece) from the refutation line.
3. Review settings: depth, and reviewing games without a human player automatically.

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
