# Handover: L2Solo Friends Server Project

This brief is for a Claude Code agent working on the owner's fork of L2Solo. It summarises the goals, the decisions already made and the plan. Paths and code details come from public README/PR descriptions and have **NOT** been verified line by line, so confirm everything in the repo before changing it.

---

## 1. The goal

Run a customised, private Lineage 2 C4 server for a small group of friends, built on L2Solo:

- Friends play together on a weekly game day.
- The world is populated by AI bots that feel like real MMORPG players.
- The server should feel like a real classic L2 server: players at every level, clans that rise and fall, rivalries, a living economy.
- Secondary: the owner may stream it and cut short-form clips, so emergent stories (clan drama, rivalries) are a feature.
- Contributions that are generic should be offered upstream.

---

## 2. The base project

- Repo: https://github.com/pmbstyle/L2Solo (site: l2solo.com). Apache 2.0. Fork of NodeL2.
- Stack: Node.js 22 LTS (22.15+), JavaScript, SQLite (older docs mention MariaDB/Docker; follow the current README). Needs a C4 protocol 656 client.
- Status: public alpha, very active (large PRs every few days, mostly by the maintainer `pmbstyle`).
- Bots ("SimPlayers"): real server sessions backed by database characters. About 1,700 bots by default.
  - **Hot bots** are near the human player and fully simulated.
  - **Cold bots** run a cheaper background simulation (worker thread proposes outcomes, main thread commits them to SQLite).
  - They have seven personality traits, goals, social memory (friends, grudges, revenge), party roles, class combat policy for all 89 C4 class stages, private stores, crafting, clans, clan halls, clan raids, PvP/PK, and optional LLM chat (OpenRouter or OpenAI-compatible endpoint).

### Missing upstream (on their roadmap, do NOT duplicate)

Clan wars, hunting-ground battles, alliances, sieges, Seven Signs, world/epic bosses, Olympiad/heroes, full quest chains (2nd/3rd class, subclass, noblesse).

### Not on upstream's near-term roadmap (we build these)

Multiple human players ("a world for a small group" is listed after 1.0), bot login/logout schedules, separate bot rates, human-relative level caps, AFK/chat realism, alts.

### Reported file locations (verify first)

- `src/GameServer/Bot/BotAI.js`, `src/GameServer/Bot/AI/States/` (HuntingState, RestingState, ShoppingState, FollowingState, MerchantState, PkHuntingState...)
- `src/GameServer/Bot/Population/`: PopulationService, BotLifeState, HotActivation, HotActorLodPolicy, ColdSimulationCoordinator, ColdSimulationWorker, BackgroundResolver, BackgroundPartyResolver, PopulationConfig
- Rewards: hot path `NpcDied.js` → `ExperienceReward.js` / `NpcRewards.js`; cold path `BackgroundResolver.js` / `BackgroundPartyResolver.js`
- Level cap: `ProgressionCap.js`, config `[Progression] contentCap`
- Tests: `tests/`, including `tests/test_hot_cold_progression_parity.js`
- Config: `config/default.ini` (committed), `config/local.ini` (git-ignored, API keys, machine settings)

### Open issues that matter

- **#117** `database is locked` (SQLite `BEGIN IMMEDIATE`) crash after long runs. Maintainer suspects two instances sharing one database.
- **#131** non-ASCII login input crashes the login server.
- **#132** players cannot create clans (Grand Master dialogue empty).
- **#122** review note: admin menu commands may be callable by unauthorised clients. Harmless solo, a risk with friends.

---

## 3. Environment and workflow

- **Mac**: coding with Claude Code. Pushes to the owner's fork.
- **GitHub fork**: `dev` branch for work in progress, `main` for what runs live. Add `upstream` remote and merge upstream into `dev` regularly.
- **Windows PC**: runs everything and hosts the game client (client is Windows-only).
  - `C:\L2Solo-live` → tracks `main`. Friends play here.
  - `C:\L2Solo-test` → tracks `dev`. Only the owner plays here.
  - Each copy has its own `config/local.ini`, own SQLite database file and own ports (live: default 2106 login / 7777 game / 8088 observer / 8090 launcher; test: different ports, e.g. 2116 / 7787 / 8098 / 8100).
  - Two client folders/shortcuts: `Client-live`, `Client-test`, each pointed at its server.
- **Auto-update scripts** (to be written, PowerShell + Task Scheduler):
  - Test copy: pull `dev` every few minutes when changed, restart.
  - Live copy: pull `main` only at scheduled times, only when no players are online, and back up the database first. Tag known-good releases so rollback is one command.
- Friends connect via a private VPN (Tailscale, ZeroTier or Radmin). The login server must advertise the VPN/reachable IP, not `127.0.0.1`.
- World saves, `local.ini` and API keys never go into git.

---

## 4. Design decisions already agreed

### Rates

- Bot XP/SP/drop/adena rates = human rates × **0.1** (configurable), in **BOTH** hot and cold reward paths.
- **Party exception**: a bot in a party that contains an online human earns human rates.
- Bot-only parties stay slow.
- Consider a per-bot daily cap on party-boosted XP to stop abuse (optional).

### Level cap

- Bot level cap relative to humans: solo bots cannot exceed highest human level + N (e.g. +3), also bounded by `contentCap`. Freeze XP at the cap rather than breaking goals. Must also apply in cold simulation.
- **NO catch-up mechanic.** This was proposed and **explicitly rejected by the owner**. A real L2 server has players at every stage; the population should be spread across all levels, not track the humans.

### Population life cycle

- New bot characters keep arriving at level 1 over time, so newbie zones stay alive.
- Some bots quit permanently.
- **Presence scheduler (login/logout)**: bots have play schedules (evening casual, weekend player, night owl, hardcore, etc.) with random jitter and skipped days, a prime-time curve, and a boost during game day. Logouts are graceful: finish the fight, go to town or sit, optionally leave a store open, then disconnect. Offline bots do not progress.

### Clans shape the server

- Clan tiers: top / mid / casual / dying, plus clanless players.
- A bot's online time = clan activity level × its own personality (e.g. Commitment trait).
- Clan activity changes over time: wins attract recruits; losses and absent leaders cause decline. Members leave dying clans for active ones. Clans can disband or merge.

### Per-level-band hierarchies (constant life cycle)

- Each clan has a **home band** (roughly average level of active members) and a **strength score** (active members, gear, recent wins).
- Rankings are **per band** (20s, 30s, 40s ... 70s), not server-wide.
- Top clans in a band claim that band's best hunting grounds and raid bosses.
- Clans level up together and move bands; vacuums are filled by the next clan; arriving clans clash or ally with incumbents; new clans constantly form at low levels.
- Clan life stages: founding, rising, dominant, plateau, decline, disband/merge.
- This should later feed upstream's clan wars and sieges when they land.

### Human realism behaviours

AFK/"brb" moments, L2-style chat (lowercase, slang like `pt`/`ks`/`gz`, WTS/WTB/WTT shouts grounded in real store inventory, LFP shouts by class and zone), bots inviting humans to parties and clans, persona presets, alts (e.g. dwarf spoiler alt, boxed buffer), a few obvious "farmer bots" for flavour. Use LLM only for direct conversations; templates for ambient chat.

### Transparency

The server is private for friends, who know the bots are bots. Don't build anything designed to deceive players.

---

## 5. Roadmap

### Phase 0 — Stability and multiplayer (must do first)

- **0.1** SQLite hardening (#117): WAL, `busy_timeout`, retry on `SQLITE_BUSY`, single-instance lock file.
- **0.2** Login input sanitising (#131).
- **0.3** Player clan creation (#132).
- **0.4** Restrict admin commands to whitelisted accounts.
- **0.5** Multi-human support: hot zone = union of all online humans' view ranges; per-human companions, chat routing, social memory; nothing assumes "the player". Start with a spike: log in two humans at once and record what breaks. **This is the biggest risk.**
- **0.6** Soak test: 3–5 clients for 6+ hours.

### Phase 1 — Rates, caps, schedules

- **1.1** Separate bot rates (hot + cold) with parity tests.
- **1.2** Party rate matching.
- **1.3** Human-relative bot level cap.
- **1.4** Presence scheduler.
- Population arrivals and quitters.

### Phase 2 — Clans and realism

- Clan activity tiers, recruitment and decline, clan switching.
- Per-band clan hierarchies and hunting-ground claims.
- AFK, chat culture pack, bots recruiting humans, personas, alts, farmer bots.

### Phase 3–4 — Content (coordinate with upstream first)

Wait for upstream on clan wars, sieges, Seven Signs, epic bosses, full quests. Build only if upstream stalls and the group needs it. Olympiad is a possible later contribution.

### Minimum viable game day

3–5 humans stable for a 6-hour session, humans can create/join clans, bot rates + party exception + relative cap working, basic presence scheduler, basic chat/AFK realism. Rough estimate: **25–35 Claude Code sessions**.

---

## 6. Working rules for the agent

- **Explain before changing.** Map the relevant hot AND cold code paths first; bots behave differently in each.
- **Write a failing test first** where possible, especially hot/cold parity tests for anything touching rewards, levels or presence.
- Small, focused branches off `dev`. One feature per branch/PR.
- Put customisations behind config flags (in `config/default.ini` with safe defaults) and in isolated modules to reduce merge pain with large upstream PRs.
- Run `npm run check` and the test suite before merging; do a live boot check (`npm start`, press Start) and look for healthy boot logs.
- Never commit `config/local.ini`, databases, saves or API keys.
- Before starting any content feature, check upstream PRs/issues/roadmap so we don't duplicate work.
- Generic improvements (multi-human, #117/#131 fixes, presence scheduler, bot rate config, chat realism) should be written cleanly enough to offer upstream. Mention AI assistance in upstream PRs.
- Ask the owner before large architectural changes.

---

## 7. Suggested first session

1. Clone the fork, install, get the server running on the Mac and read the README.
2. Produce a short map of: reward flow (hot + cold), `ProgressionCap`, `PopulationService`/`BotLifeState`/`HotActivation`, and every place that assumes a single human player.
3. Fix **#131** (small, good warm-up), then implement **1.1 + 1.2** (bot rate multiplier with party exception) with parity tests.
4. Then run the two-human spike (**0.5**) and report findings before planning multi-human work.

---

## 8. Caveats

- File paths and behaviours above are from PR descriptions and the README; verify them.
- Upstream moves fast; expect merge conflicts every sync.
- Lineage 2 and its client are NCSOFT's property. Keep the server private, don't monetise it or distribute the client.
