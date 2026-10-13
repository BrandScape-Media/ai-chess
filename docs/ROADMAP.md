# Roadmap

What comes next, in build order. Done items move to the README.

## Phase B: Game Review (1.3.0)

Done in 1.3.0: Stockfish ships with the game; deep review (depth 18) by default, saved with the game; the Review tab (accuracy, estimated game rating, opening name and book moves, evaluation graph, every class for both sides including Book and Miss, phases, key moments); a coach that explains every move from the engine's lines; "Explain" with your own AI model, given only the engine's facts; Retry your mistakes, one by one or as a drill (answer after two tries); Your mistakes in Puzzles, until solved twice in a row.

Next:
1. Better "Great" and "Brilliant": the engine's second-best move (MultiPV) to spot only-moves.
2. Mistake themes in the coach (fork, pin, hanging piece) from the refutation line.
3. Review settings: depth, and reviewing games without a human player automatically.

## Phase C: Puzzles (1.3.1)

1. Daily puzzle with a streak.
2. Themes dashboard: accuracy per theme (lichess themes), "Practise this theme".
3. Storm-style combos in Puzzle Rush: bonus seconds for runs of correct moves, a time penalty for a miss.
4. Puzzle Battle against a bot that solves at a simulated rating.
5. Optional download of the full lichess puzzle database (about 5 million puzzles, offline). Python's standard library has no zstd before 3.14, so host a repacked, rating-bucketed copy on the Releases page and serve it through `/api/puzzles?rating=&theme=`.

## Phase D: Tournaments (1.3.2)

Engines and AI models play each other in the background, and you play your own games on the main board.

* A background match runner (engines through `/api/engine/go`, models through `/api/llm/chat`, one local model at a time), results in `data/tournaments.json`.
* Formats, in order: round-robin / Swiss (Buchholz tie-break), knockout (winner plays winner), timed arena (most consecutive wins, streak bonus), and a "most Elo gained" event.
* A Tournaments tab: lobby with presets, live standings or bracket, "your next game" cards, mini boards of the background games.

## Phase E: Leagues

Weekly divisions from Wood to Legends, built from your rated results against the bot pool: a score to beat every week.

## Phase F: your account (research done, to build after D and E)

A home for you as a player: who you are, how you are improving, and what happened while you were away. Everything stays on this computer, so "friends", "messages" and "notifications" become your regular opponents, your saved game chats and local events.

### The account corner

* At the bottom of the rail, where the GitHub link is now (it moves to Settings > About): your round picture, your name, and a flame with your streak in days. A dot on the picture means unread notifications.
* Above the picture, a 2 by 2 grid of small icons, as on chess.com: Opponents, Chats, Notifications (with a count) and Settings (it leaves the main list). At 960px or narrower the rail is a top row, so the corner shows only the picture and the bell, top right.
* Clicking the picture opens a popover (the same `.pop` as the strength picker): picture, name, flag, level badge, game rating, puzzle rating, then Profile, Opponents, Chats, Notifications, Settings, and Switch profile when there is more than one.
* **Opponents**: everyone you have played, grouped by `personaKey` (`engine:<id>`, `llm:<provider>|<model>`). Each row has the picture, wins, draws and losses against you, last played, your average accuracy against them, their personality, and Play again (fills the seat with the same engine, model and strength).
* **Chats**: the chat saved with each game, grouped by opponent, last line as preview. Opening one replays the game with its chat, read-only. Search across all chats.
* **Notifications**: local events only (see below).

### The profile page

A new panel tab, `tab-profile`, so the board stays visible. Views: Overview, Stats, Achievements, Opponents, Chats.

* **Identity**: name (used in the PGN instead of "Player", on the player card and in History; the board still says "You"), picture from the app's avatar set, from new Krea 2 presets or your own image, country flag (bundled SVG flags, no emoji), a status line, an optional over-the-board rating, and "playing since" from your first game.
* **Ratings per time control**, by base + 40 × increment: bullet under 3 minutes, blitz under 8, rapid under 25, classical 25 or more, untimed with no clock. Also per opponent type: engines and AI models. Variants are unrated. `profile.rating` stays as the overall rating that levels and default strengths use.
* **Rating graph** for 7 days, 30 days, 90 days, 1 year or all time, with peak and its date, best win (opens the game), longest winning streak, and average opponent rating for wins, draws and losses. Filter by White, Black or both.
* **Accuracy trend** from saved reviews (`review.acc`), with the estimated game rating as a second line, and your openings with games and score.
* **Puzzles**: rating with its own graph, solved, best streak, best Rush, and the daily puzzle calendar (from Puzzles).
* **Streak**: a day counts when you finish a game, a puzzle or a review. One missed day is forgiven, the second resets it. The flame grows with the streak and can be hidden.
* **Activity**: the last 7 days, one line per day ("Played 4 games, won 3, +22. Solved 12 puzzles.").

### Achievements

Earned only, never bought. Locked ones show grey with their rule. Checked after each game, review and puzzle, and once over the whole history on first start, so old games count. Each badge is a Krea 2 sticker. Games where you used hints, takebacks or Peek do not count.

1. First game, first win, first draw, first win by checkmate, first win on time.
2. 10, 50, 100 and 500 games finished.
3. Rating milestones: every 100 points from 800, overall and per time control.
4. Beat each engine once. Ladders: every Stockfish Elo step, Maia 1100 to 1900, every built-in level.
5. Beat an AI model; beat 5 different models.
6. Win in 20 moves or fewer; win in every variant and in Chess960.
7. From reviews: 90% accuracy or more, a game with no blunders, a Brilliant move, a win after being -3 or worse.
8. Puzzles: 10, 100 and 1,000 solved; 20 or more in Rush; daily puzzle 7 and 30 days in a row.
9. Streak of 7 and 30 days. Fix 10 and 50 of Your mistakes (needs a new counter).

### Notifications

* Events: achievement unlocked, new peak rating, deep review finished, new positions in Your mistakes, daily puzzle ready, streak ends tomorrow, Stockfish or an engine install ready, an AI against AI game finished while the window was hidden (the tab title flashes), engine update available (opt in, checked at most once a day).
* Where: the count on the corner, and a list in the popover and the profile, newest first. Toasts still show the moment it happens.
* Server events come through the `/api/pending` long poll the page already keeps open.
* Dismiss: opening the list marks all as read; each item has a close button; Clear all. The list keeps 100 items or 30 days. Each kind can be turned off.

### Settings

Settings > You moves into the profile, and its tab links there. New: name, picture and flag; show streak; one switch per notification kind; export (profile JSON, all games as PGN) and import; reset profile, which keeps engines and AI providers.

### Several local profiles (optional, last)

* For a family on one computer or over LAN. The first profile keeps today's files, so nothing moves.
* Extra profiles live in `data/profiles/<id>/`: `profile.json`, `history.json`, `practice.json`, `last_game.json`, `avatar.webp`.
* `settings.json` keeps what belongs to the machine: providers and API keys, engines, coach model, personalities.
* The active profile is chosen per window or device (`aichess.profile` in localStorage, sent with every API call). The game state and the active page become one per profile, so two people can play at once.
* No passwords, at most a PIN as a speed bump. API keys never go into a profile or an export. In LAN mode only the host can change AI providers and engines.

### Data model

* New `data/profile.json`: `{v, name, avatar, flag, status, otb, since, ratings: {overall, bullet, blitz, rapid, classical, untimed, engines, models}, ratingLog: [{t, r, tc}], puzzleLog, streak: {days, last, best}, achievements: {id: date}, counters}`.
* New `data/notifications.json`: `[{id, kind, text, date, read, link}]`.
* Migration on first start: the server copies `settings.profile` and `settings.puzzles` into `profile.json` (the old keys stay one release for downgrades), then replays `history.json` in date order to fill the per time control ratings and the rating log.
* Profile writes go through `POST /api/profile` with small operations (`{op: "game", id}`), applied on the server under a lock. A stale window can then no longer overwrite a newer rating.
* `history.json` records gain the hint, takeback and Peek flags; the saved review gains class counts, the game rating estimate and the opening name and ECO (old games filled once from `evals`).
* Each AI model keeps a rating keyed by `personaKey`, updated from its games against you, instead of a random number each game.
* Uploaded pictures are saved as files, not data URLs inside `settings.json`.
* `GET /api/history?summary=1` returns games without evals, PGN and chat, for Stats and Opponents.

### Out of scope

Real friends and who is online, messages to other people, followers and profile views, rank or percentile against other players, clubs, trophies from other players, memberships, email and phone notifications.

### Build order

1. **F0, fixes first**: profile writes through the server; in LAN mode, clear a provider's stored key when its address changes; the history summary endpoint.
2. **F1, corner and identity**: the rail corner and popover, the profile tab with name, picture, flag, current ratings and puzzle stats, `profile.json` with its migration, and the Krea 2 art (picture presets, empty states).
3. **F2, ratings**: per time control and per opponent type with backfill, the rating log and graph, peak, best win, result streaks, lasting AI model ratings.
4. **F3, opponents and chats**: the head-to-head list with Play again, the chat list with search.
5. **F4, achievements and streak**: badges with backfill, the day streak and flame.
6. **F5, notifications**: events, the list, settings switches.
7. **F6, insights**: accuracy trend, openings, results by opponent and time of day, the activity feed, later a yearly recap.
8. **F7, several profiles** (only if wanted).

### Open questions

1. Is this for you alone, or should F7 (a profile per family member) be planned for real?
2. Should games against AI models change your rating before they have lasting ratings of their own?
3. Should games with hints or takebacks be unrated, or rated and marked?
4. "Opponents" or "Rivals" for the friends list?
5. Bundle SVG flags (about 250 KB) or show a two-letter country code?
6. Keep Elo, or move to Glicko-2 with a "?" while a rating is still settling?

## Why (what makes the big sites sticky)

* Game Review is the feature people pay for: accuracy, move labels, key moments, a coach, retrying your mistakes.
* Puzzle Rush and Puzzle Battle give you a score to beat.
* Leagues give you something to climb.
* There is always an opponent at your level.
