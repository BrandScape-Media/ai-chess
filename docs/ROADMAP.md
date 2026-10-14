# Roadmap

What comes next, in build order. Done items move to the README.

## Phase B: Game Review (1.3.0)

Done in 1.3.0: Stockfish ships with the game; deep review (depth 18) by default, saved with the game; the Review tab (accuracy, estimated game rating, opening name and book moves, evaluation graph, every class for both sides including Book and Miss, phases, key moments); a coach that explains every move from the engine's lines; "Explain" with your own AI model, given only the engine's facts; Retry your mistakes, one by one or as a drill (answer after two tries); Your mistakes in Puzzles, until solved twice in a row.

Added in 1.4.0: a rating for each game phase, and illegal moves explained (a piece out of nowhere, taking its own piece, jumping over pieces, the wrong shape).

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

## Phase E: Variants (1.4.0)

Done in 1.4.0: 52 variants on a second board, next to the five on the normal board (Chess960, King of the Hill, Three-check, Transcendental, a custom position).

* **Rules** come from ffish, Fairy-Stockfish's rules compiled to WebAssembly (GPL-3.0, in `web/vendor/ffish/`): legal moves, notation and the end of the game for every variant, offline.
* **The variant board** (`web/js/vboard.js`) handles any size from 3 by 4 to 12 by 10, pieces in hand and drops, promotion and gating choices, the duck, xiangqi and janggi on the points with river and palaces, shogi pentagons with their kanji, and the Dobutsu animals. New pieces are drawn from your piece set: compound pieces get a second piece as a badge (archbishop, chancellor, amazon, centaur), new movers are upside down (grasshopper, nightrider, cannon), the old short-range pieces are smaller (fers, alfil, mann), the royal knight wears a crown.
* **Who plays**: Fairy-Stockfish (the big-board build, which the installer now picks; it plays 91 variants at any strength), the variant bot (a small search on the rules library, easy to hard, plays every variant even without Fairy-Stockfish), AI models (the rules, the board and the legal moves in the prompt), and people.
* **A rating per variant**, provisional for the first games, on the variant cards, the board and the result card. Variant games count for the weekly league.
* **Variant tournaments**: every format, in any variant; the background games run on the rules library and show on small boards of the right shape.
* The variant's rules on its tab, a Krea 2 picture for every variant, the history and replays.
* The groups: same pieces with new rules (Crazyhouse, Atomic, Antichess, Horde, Racing Kings, Duck chess and more), new pieces (Seirawan, Amazon, Grasshopper, Nightrider...), bigger boards (Capablanca, Grand, Shako, Courier...), Xiangqi and Shogi (with Janggi, Manchu and the small shogis), old and Southeast Asian chess (Shatranj, Chaturanga, Makruk, Sittuyin), small boards (Los Alamos, Gardner, Jeson Mor, Ataxx).

Next:
1. Fog of war: no engine plays it; it needs hidden squares on the board and a bot that plays without seeing.
2. More variants from Fairy-Stockfish's variants.ini (Spartan, Orda, Synochess, Shinobi): they need the config loaded into both the rules library and the engine.
3. A "variant of the week" in the league, and puzzles from your own variant games.
4. The review for variant games (Fairy-Stockfish can analyse them; the board, graph and move classes need the variant board).

## Phase F: your account (research done, to build next)

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

### Also in Phase F: polish and a name (added 2026-10-14)

* **Settings**: one column of plain sections instead of tabs inside a dialog (Profile, Board and pieces, Play, AI models, Engines, Chat, About), a search box, live previews (the board theme on a small board, a piece set row), and every switch explained in one line under it instead of in a tooltip.
* **The rail on the left**: group it (Play, Puzzles, Compete, then History and Settings at the bottom), a small rating chip under Play, a dot on Compete when a tournament game waits, a collapsed icon-only mode on small screens, and a profile picture at the bottom that opens the Phase F profile.
* **A new name and icon (ideas)**: "AI Chess" is plain and hard to search. Candidates:
  * **Rookery**: a rook's home, a free and friendly place; easy to say, the icon is a rook with a small spark.
  * **Open Board**: says free and open source; the icon is a board corner.
  * **Kibitz**: chess slang for someone commenting on a game, fits the AI models that chat and coach.
  * **Fianchetto**: memorable for chess players, harder for everyone else.
  * **Homegame**: your own chess site at home, offline.
  The icon would be made in the same sticker style as the avatars, with a flat version for the tab and the taskbar. Check that the name is free on GitHub, as a .com/.org and in app stores before choosing.

### Also in Phase F: more AI (brainstorm)

* **An MCP server**: AI Chess offers its tools to any AI client (Claude Desktop, LM Studio, other MCP hosts): "start a game", "make a move", "show the board", "analyse this position", "review my last game", "find a puzzle on forks". You could then play or study from your AI chat, and agents could use the engines.
* **Tools for the AI models inside the app** (models that support tool calls): ask the engine for an evaluation or the best moves at a set strength, look up the opening (bundled names, or the lichess opening explorer online: how often a move is played and how it scores), the endgame tablebase (lichess, online, 7 pieces), search your own game history ("the last time I played the Sicilian"). A coach that checks itself against the engine instead of guessing.
* **Online data, always optional**: lichess opening explorer and tablebase APIs (free, no key), the lichess masters database for "what did the grandmasters play here". Offline the app works as now.
* **A coach mode**: talk to a model about the position on the board, it can set up lines on a second board, and every claim is checked with the engine first.

## Phase G: bots with personality (brainstorm, after F)

Like the chess.com bots: each one a character with a picture, a rating, a style and lines to say.

### Bots without AI (always available)

* A bot = a strength (an engine capped at an Elo, or the built-in engine at a level) plus a **style** that reorders the engine's top moves:
  * favourite openings (a small opening book per bot: "always plays the London", "loves the King's Gambit");
  * favourite pieces ("never trades its knights", "brings the queen out early");
  * targets ("goes after your queen", "grabs every pawn", "trades down to an endgame");
  * temperament (attacks the king, castles late, blunders when short of time, offers draws when behind).
  The engine gives its best few moves with their scores; the style adds a bonus to the moves it likes and picks among the ones that are not much worse. Strength stays honest, the character shows.
* Prerecorded lines for each bot: greeting, after a capture, when winning, when losing, at the end. The chat engine already has events for these.
* Variant bots with their own plans: "drops every piece it captures right away" (Crazyhouse), "races the king from move one" (Racing Kings), "keeps the duck next to your king" (Duck chess), "explodes everything" (Atomic).

### Bots with an AI model (when a model is connected)

* More personality: they talk freely, remember the game, react to your chat, have a backstory and a way of speaking.
* **Engine-assisted moves**: each AI bot has an engine at its own level ("Juan" asks a 700 Elo engine, "Mira" a 1600 one). The model gets that engine's top three moves with scores and picks one in character, then says why. The engine keeps it legal and at its level; the model gives it a voice and a style. Without the engine the model plays on its own, as now.
* A roster screen like chess.com's: bots grouped by level (Beginner, Intermediate, Advanced, Master), locked ones that open as you beat the one before, and a "bot of the week".

## Phase H: getting it to people, and online play (brainstorm)

### Presenting the app

* A one-page website (GitHub Pages, free): what it is in one sentence ("Free chess with AI opponents, engines, puzzles and tournaments. Runs on your computer, no account, no ads"), a short video of a game against a talking model, the downloads, and screenshots of review, puzzles, tournaments and variants.
* Where people look: r/chess, r/LocalLLaMA (local models playing chess is a natural fit), r/selfhosted, Hacker News "Show HN", lichess forums, Product Hunt, chess YouTubers and streamers who play bots.
* Short clips work best: "my local model playing atomic chess and trash-talking", "Stockfish 1200 against a 7B model".
* GitHub: a clean README with a GIF at the top, topics (chess, llm, stockfish, local-ai), releases for every system, an issue template for bugs and ideas.
* Translations later (the text is plain and short, so it translates well).

### Online play

* **Peer-to-peer first** (no server to pay for): WebRTC between two browsers, with a tiny public signalling step or a game code you send to a friend; on a LAN it can connect directly. Good for playing friends; no matchmaking, no ratings that strangers can trust.
* **A small server later** if people want matchmaking: a lobby, rated games and tournaments between people, puzzles battles online. That needs hosting, accounts and moderation, which is real work and some cost; lichess already does this well, so the app's own strength stays the AI and offline side.
* **A web version**: the app is already a web page with a small Python server. A hosted version could run with browser-only parts (the built-in engine, Stockfish in WebAssembly, ffish for variants, cloud AI keys stored in the browser). Local models would still need the desktop app, or a model server the browser can reach.

## Why (what makes the big sites sticky)

* Game Review is the feature people pay for: accuracy, move labels, key moments, a coach, retrying your mistakes.
* Puzzle Rush and Puzzle Battle give you a score to beat.
* Leagues give you something to climb.
* There is always an opponent at your level.
