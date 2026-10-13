`puzzles.json` is a sample of 3,182 puzzles from the lichess puzzle database
(https://database.lichess.org/#puzzles), released under CC0. Picked for low rating deviation, high popularity and
at least 800 plays, about 150 per 100-point rating band from 500 to 2700.

Fields: `id` (lichess puzzle id), `fen` (position before the opponent's move), `moves` (UCI; the first move is the
opponent's, then the solution alternates), `r` (rating), `t` (themes).
