# Roadmap

What comes next, in build order. Done items move to the README.

## Phase B: Game Review (1.3.0)

Done in 1.3.0: Stockfish ships with the game; deep review (depth 18) by default, saved with the game; the Review tab (accuracy, estimated game rating, opening name and book moves, evaluation graph, every class for both sides including Book and Miss, phases, key moments); a coach that explains every move from the engine's lines; "Explain" with your own AI model, given only the engine's facts; Retry your mistakes, one by one or as a drill (answer after two tries); Your mistakes in Puzzles, until solved twice in a row.

Next:
1. Better "Great" and "Brilliant": the engine's second-best move (MultiPV) to spot only-moves.
2. Mistake themes in the coach (fork, pin, hanging piece) from the refutation line.
3. Review settings: depth, and reviewing games without a human player automatically.

## Phase C: Puzzles (1.3.1)

Done in 1.3.1: the daily puzzle with a streak; the themes dashboard (strengths, what needs work) with Practise this theme; Storm-style combo bonus seconds in Puzzle Rush; Puzzle Battle against a bot; the optional download of the full lichess puzzle database (about 5 million puzzles, offline, SQLite, picked by rating and theme). Also in 1.3.1: the first-start level picker, the History redesign, chat that stays with its game.

Done in 1.3.2: artwork for Rush, Daily, Themes, Battle's puzzle bot and the database card (Krea 2).

Next:
1. Puzzle Battle against another person on the LAN.
2. A puzzle rating graph (comes with Phase F's profile).

## Phase D: Tournaments and Leagues (1.3.2)

Done in 1.3.2: the **Compete** tab.

* **Tournaments** run in the background while you play your own games on the main board. The match runner has two lanes, each with its own web worker for the built-in engine and its own copy of every UCI engine (slots `t1`, `t2`, one thread each), so your game and the analysis never slow down. AI models play one game at a time. Results are saved in `data/tournaments.json`; logic in `web/js/tourney-core.js` (tested), runner in `web/js/tourney-runner.js`, screens in `web/js/compete.js`.
* Five formats: round-robin, Swiss (no rematches while avoidable, colour balance, Buchholz), knockout (seeded bracket, a drawn game is replayed with colours swapped, after three draws the higher seed goes through), arena (timed, 2/1/0 with double points after two wins in a row, or "longest streak wins"), and the rating climb (the biggest rating gain wins).
* The field is built around your rating from what you have installed: built-in levels, engines at a set Elo, Maia, the historic bots and your AI model, if you want them.
* Your game shows as a card with a Play button; it is played on the main board with the tournament's clock, no takebacks and no hints. Live standings or the bracket, the background games on small boards, every result replayable.
* **Weekly league**: seven divisions (Pawn, Knight, Bishop, Rook, Queen, King, Legend) with Krea 2 emblems. Rated games against the computer earn points (win 3, 4 against someone 100 or more above you, draw 1, tournament games one more, a tournament podium 10/6/4). The top 5 of 30 move up each week, the bottom 5 move down, a week without games changes nothing. Rivals are simulated from the bot pool and are the same every time you look (`web/js/league-core.js`, tested).

Next:
1. A wider bracket view: open the bracket full width over the board.
2. Team events (engines against AI models), and a "gauntlet": you against every engine in turn.
3. A weekly league recap card, and league trophies on the profile (Phase F).

## Phase E: Variants (brainstorm, to build next)

Today: Standard, Chess960, King of the Hill, Three-check, Transcendental, any position from a FEN. Every variant should get its own picture, a rules card with a small board showing the special rule, and a prompt that explains the rules to AI models.

### Who plays them

* **The built-in engine** (`core.js`) learns each variant's rules: move generation, end of game, a few evaluation terms. It is the opponent that always works, and it checks every move.
* **Fairy-Stockfish** (already in the catalog) plays almost every variant below at full strength through `UCI_Variant`. It becomes the default engine for variants; the other engines play standard chess only.
* **AI models** get the rules in the prompt; the legal moves list matters even more here.

### Tier 1: same board, same pieces, new rules (cheapest)

1. **Crazyhouse**: captured pieces change sides and can be dropped back on the board. Needs a pocket next to the board and drop moves (`P@e4`).
2. **Atomic**: a capture explodes and removes every piece around it except pawns; blow up the king to win.
3. **Antichess** (giveaway): captures are forced and the goal is to lose all your pieces.
4. **Horde**: White has 36 pawns and no king; Black must take them all.
5. **Racing Kings**: no checks allowed, first king to the 8th rank wins.
6. **Duck chess**: after every move you place the duck, a blocker nobody can capture; there is no check, you win by taking the king.
7. **Fog of war** (dark chess): you only see the squares your pieces reach. Fun against AI models, who are already half blind.

### Tier 2: new pieces on the 8 by 8 board

Pieces from the chess variants wiki's list, each needing its own art:
* **Archbishop** (bishop + knight), **Chancellor** (rook + knight), **Amazon** (queen + knight).
* **Camel** (3,1 leaper), **Zebra** (3,2), **Wildebeest** (knight + camel), **Grasshopper** (hops over a piece and lands just behind it), **Knight-rider**, **Alfil** and **Ferz** (the old bishop and queen of shatranj), **Wazir**, **Sergeant** and **Berolina** pawns (move diagonally, capture straight).
* Variants built on them: **Seirawan chess** (hawk and elephant enter the board from the back rank), **Almost Chess** (a chancellor instead of the queen), **Amazon chess**, **Grasshopper chess**, **Shatranj** (the medieval game), and a **Fairy mix** where each side gets random fairy pieces.

### Tier 3: bigger boards and other families (most work)

* **Capablanca chess** (10 by 8, archbishop and chancellor), **Grand chess** (10 by 10). `core.js` uses a 0x88 board, which fits 10 files but not 10 ranks: Grand chess needs a new board layout, and the board, arrows and pictures must handle any size.
* **Xiangqi**, **Shogi**, **Makruk**: whole other chess families with their own boards and pieces. Fairy-Stockfish plays them; the board would need a new look per family.

### Art

* Every variant: a Krea 2 card picture like the hub cards, in the same sticker style.
* Fairy pieces: drawing them in all 12 piece sets is not realistic. Plan: one **variant piece set** in a clean classic style, white and black, built from the standard silhouettes with a clear mark for the extra move (for example a knight's head on a bishop's body for the archbishop), drawn as SVG so they stay sharp; Krea 2 for first designs. A game with fairy pieces uses that set for the fairy pieces only. The wiki's own images are CC-BY-SA, so we draw our own.

### Ratings and modes

* A separate rating per variant (provisional for the first 5 games), shown on the variant card.
* Variant tournaments, and a "variant of the week" in the league.
* Puzzles for variants are out of scope (no open database).

### Suggested order

1. 1.4.0: Crazyhouse, Atomic, Antichess, Horde, Racing Kings (Fairy-Stockfish plus `core.js` rules), the rules cards and the art.
2. 1.4.1: Duck chess and Fog of war (new interaction: placing the duck, hidden squares).
3. 1.4.2: the fairy piece set, then Seirawan, Almost Chess, Amazon, Grasshopper and Shatranj.
4. Later: Capablanca and Grand chess (board sizes), then the other families.

### Open questions

1. Which three variants matter most to you for 1.4.0?
2. Should variants be rated separately from your main rating?
3. Is Fairy-Stockfish as the only real engine for variants fine, or should the built-in engine reach a good strength in each?
4. Fog of war: should AI models see the whole board (easier for them) or only their own fog?

## Phase F: your account (research done, to build after E)

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

### Ties to Compete (added with 1.3.2)

* Tournament results on the profile: tournaments played, podiums, titles won, with the trophy art; a best placing per format.
* League history: the division reached each week as a small emblem strip, the highest division ever, weeks promoted in a row.
* Achievements from Compete: first tournament, first title, win a knockout without losing a game, a 5-win streak in an arena, reach each league division.
* Notifications from Compete: your tournament game is ready, a tournament ended, the league week ended (promoted, stayed, relegated).
* Variant ratings (Phase E) shown next to the main rating.

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
